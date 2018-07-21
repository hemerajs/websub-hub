'use strict'

const Schemas = require('./lib/schemas')
const Fastify = require('fastify')
const FormBody = require('fastify-formbody')
const FastifyBoom = require('fastify-boom')
const Mongodb = require('fastify-mongodb')
const Got = require('got')
const Hyperid = require('hyperid')
const Boom = require('boom')
const Hoek = require('hoek')
const Pino = require('pino')
const Serializer = require('./lib/serializer')
const safeEqual = require('./lib/safeEqual')
const Crypto = require('crypto')
const PEvent = require('p-event')
const MimeTypes = require('mime-types')
const PMap = require('p-map')
const Stream = require('stream')
const Utils = require('./lib/utils')

module.exports = build

const defaultLeaseInSeconds = 864000 // 10 days
const verifiedState = {
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
  HTTP_ERROR: 'HTTP_ERROR'
}
const requestMode = {
  SUBSCRIBE: 'subscribe',
  UNSUBSRIBE: 'unsubscribe'
}
const collections = {
  subscription: 'subscription',
  audit: 'audit'
}

const defaultOptions = {
  name: 'hub',
  port: 3000,
  address: 'localhost',
  hubUrl: '',
  timeout: 2000,
  logLevel: 'info',
  prettyLog: false,
  logger: null,
  https: null,
  mongo: {
    url: '',
    useNewUrlParser: true
  },
  retries: 2
}

function build(options) {
  options = Hoek.applyToDefaults(defaultOptions, options || {})
  return new WebSubHub(options)
}

/**
 *
 *
 * @param {any} options
 * @returns
 */
function WebSubHub(options) {
  this.options = options
  this._configureLogger()

  this.server = Fastify({
    https: this.options.https,
    logger: {
      pinoInstance: this.log
    }
  })
  this.server.register(FastifyBoom)
  this.server.register(FormBody)
  this.server.register(Mongodb, this.options.mongo).after(err => {
    if (err) {
      throw err
    }
    const { db } = this.server.mongo
    this.subscriptionCollection = db.collection(collections.subscription)
    this.auditCollection = db.collection(collections.audit)

    return this._setupDbIndizes()
  })

  this.httpClient = Got
  this.hyperid = Hyperid()
  this._registerHttpHandler()
}

WebSubHub.prototype._getHubUrl = function() {
  if (this.options.hubUrl) {
    return this.options.hubUrl
  }

  return (
    (this.options.https ? ':' + 'https://' : 'http://') +
    this.options.address +
    (this.options.port ? ':' + this.options.port : '')
  )
}

WebSubHub.prototype._configureLogger = function() {
  const loggerOpts = {
    name: this.options.name,
    serializer: Serializer,
    safe: true, // handle circular refs
    level: this.options.logLevel
  }
  if (this.options.logger instanceof Stream.Stream) {
    this.log = Pino(loggerOpts, this.options.logger)
  } else if (this.options.logger) {
    this.log = this.options.logger
  } else {
    const pretty = this.options.prettyLog ? Pino.pretty() : undefined
    this.log = Pino(loggerOpts, pretty)
    // Leads to too much listeners in tests
    if (pretty && this.options.logLevel !== 'silent') {
      pretty.pipe(process.stdout)
    }
  }
}

WebSubHub.prototype._setupDbIndizes = async function() {
  return this.subscriptionCollection.createIndex(
    { leaseEndAt: 1 },
    { expireAfterSeconds: 0 }
  )
}

/**
 * The hub verifies a subscription request by sending an HTTP [RFC7231] GET request to the subscriber's callback URL as given in the subscription request.
 * The subscriber must confirm that the hub.topic corresponds to a pending subscription or unsubscription that it wishes to carry out.
 * If so, the subscriber must respond with an HTTP success (2xx) code with a response body equal to the hub.challenge parameter.
 * If the subscriber does not agree with the action, the subscriber must respond with a 404 "Not Found" response.
 * @param {*} param0
 * @param {*} challenge
 */
WebSubHub.prototype._verifyIntent = async function(
  { callbackUrl, mode, topic, callbackQuery, leaseSeconds },
  challenge
) {
  let response
  try {
    response = await this.httpClient.get(callbackUrl, {
      timeout: this.options.timeout,
      retries: this.options.retries,
      json: true,
      query: {
        ...callbackQuery,
        'hub.topic': topic,
        'hub.mode': mode,
        'hub.challenge': challenge,
        'hub.lease_seconds': leaseSeconds
      }
    })
  } catch (err) {
    this.log.error(
      err,
      `could not request subscription callback '%s', statusCode: %d`,
      callbackUrl,
      err.statusCode
    )
    return verifiedState.HTTP_ERROR
  }

  if (
    response.body &&
    response.body['hub.challenge'] &&
    challenge &&
    safeEqual(response.body['hub.challenge'], challenge)
  ) {
    return verifiedState.ACCEPTED
  }

  return verifiedState.DECLINED
}

/**
 *
 * @param {*} sub
 * @param {*} content
 */
WebSubHub.prototype._distributeContentHttp = async function(sub, content) {
  const headers = {}

  if (sub.format === 'json') {
    headers['content-type'] = 'application/json'
  } else if (sub.format === 'xml') {
    headers['content-type'] = 'application/xml'
  }

  // The request MUST include at least one Link Header [RFC5988] with rel=hub pointing to a Hub associated with the topic being updated.
  // It MUST also include one Link Header [RFC5988] with rel=self set to the canonical URL of the topic being updated.
  headers.link = `<${this._getHubUrl()}>; rel="hub", <${sub.topic}>; rel="self"`

  // must send a X-Hub-Signature header if the subscription was made with a hub.secret
  // https://w3c.github.io/websub/#signing-content
  if (sub.secret) {
    const stream1 = content.stream.pipe(new Stream.PassThrough())
    const stream2 = content.stream.pipe(new Stream.PassThrough())

    const hmac = Crypto.createHmac('sha256', sub.secret).setEncoding('hex')
    const hashStream = stream1.pipe(hmac)

    await PEvent(hashStream, 'readable')
    headers['x-hub-signature'] = 'sha256=' + hmac.read()
    return this._sendContentHttp(sub, stream2, headers)
  }

  return this._sendContentHttp(sub, content.stream, headers)
}

WebSubHub.prototype._sendContentHttp = async function(sub, source, headers) {
  const stream = source.pipe(
    this.httpClient.stream.post(sub.callbackUrl, {
      query: sub.callbackQuery,
      retries: this.options.retries,
      headers,
      timeout: this.options.timeout
    })
  )

  try {
    await PEvent(stream, 'response')
  } catch (err) {
    this.log.error(
      err,
      `content could not be published over HTTP to '%s'`,
      sub.callbackUrl
    )

    throw Boom.badRequest('content could not be published')
  }
}

/**
 *
 * @param {*} req
 * @param {*} reply
 */
WebSubHub.prototype._handlePublishRequest = async function(req, reply) {
  const topicUrl = req.body['hub.url']

  const subscriptions = await this.subscriptionCollection
    .find({
      topic: topicUrl
    })
    .toArray()

  const mapper = async sub => {
    // swallow errors in order to handle the distribution process not transactional
    try {
      const content = await this._fetchTopicContent(sub)
      await this._distributeContentHttp(sub, content)
    } catch (err) {
      this.log.error(
        err,
        `topic content could not be published to subscriber with url '%s'`,
        sub.callbackUrl
      )
    }
  }

  try {
    await PMap(subscriptions, mapper, { concurrency: 4 })
  } catch (err) {
    this.log.error(err, 'could not fetch and distribute content')
    reply.send(err)
    return
  }

  reply.code(200).send()
}

/**
 *
 * @param {*} sub
 */
WebSubHub.prototype._fetchTopicContent = async function(sub) {
  const headers = {}

  if (sub.format === 'json') {
    headers.accept = 'application/json'
  } else if (sub.format === 'xml') {
    headers.accept = 'application/xml'
  }

  let stream = null

  try {
    stream = await this.httpClient.get(sub.topic, {
      stream: true,
      retries: this.options.retries,
      headers,
      timeout: this.options.timeout
    })
  } catch (err) {
    this.log.error(err, `from topic '%s' could not be fetched`, sub.topic)
    throw Boom.notFound('from topic could not be fetched')
  }

  let contentType = sub.format

  const response = await PEvent(stream, 'response')

  if (response.headers) {
    contentType = MimeTypes.extension(response.headers['content-type'])
  }

  return {
    stream,
    contentType
  }
}

/**
 *
 *
 * @param {any} req
 * @param {any} reply
 */
WebSubHub.prototype._handleSubscriptionRequest = async function(req, reply) {
  const mode = req.body['hub.mode']
  const leaseSeconds = req.body['hub.lease_seconds'] || defaultLeaseInSeconds
  const secret = req.body['hub.secret']
  const format = req.body['hub.format']
  const challenge = this.hyperid()

  const normalizedTopicUrl = Utils.normalizeUrl(req.body['hub.topic'])
  const topicQuery = normalizedTopicUrl.query
  const topicUrl = normalizedTopicUrl.url

  const normalizedCallbackUrl = Utils.normalizeUrl(req.body['hub.callback'])
  const callbackQuery = normalizedCallbackUrl.query
  const callbackUrl = normalizedCallbackUrl.url
  const protocol = normalizedCallbackUrl.protocol

  const sub = {
    mode,
    callbackUrl,
    callbackQuery,
    protocol,
    topic: topicUrl,
    topicQuery,
    leaseSeconds,
    secret,
    format
  }

  const intentResult = await this._verifyIntent(sub, challenge)

  if (intentResult === verifiedState.DECLINED) {
    reply.send(Boom.forbidden('subscriber has declined'))
    return
  } else if (intentResult === verifiedState.HTTP_ERROR) {
    reply.send(Boom.forbidden('subscriber could not be verified'))
    return
  }

  this.log.info(`'%s' for callback '%s' was verified`, mode, callbackUrl)

  if (mode === requestMode.SUBSCRIBE) {
    await this._createSubscription(sub)
    this.log.info(`subscription for callback '%s' was created`, callbackUrl)
  } else if (mode === requestMode.UNSUBSRIBE) {
    await this._unsubscribe(sub)
    this.log.info(`subscription for callback '%s' was deleted`, callbackUrl)
  } else {
    throw Boom.notImplemented(`mode '${mode}' is not implemented`)
  }

  reply.code(200).send()
}

/**
 *
 *
 * @param {any} req
 * @param {any} reply
 */
WebSubHub.prototype._handleSubscriptionListRequest = async function(
  req,
  reply
) {
  try {
    const cursor = this.subscriptionCollection.find({
      leaseEndAt: { $gte: new Date() }
    })
    cursor.project({
      secret: 0
    })
    const list = await cursor
      .skip(req.query.start)
      .limit(req.query.limit)
      .toArray()
    reply.code(200).send(list)
  } catch (err) {
    reply.send(Boom.wrap(err, 500, 'subscription could get subscriptions'))
  }
}

/**
 *
 *
 * @param {any} topic
 * @param {any} callbackUrl
 * @returns
 */
WebSubHub.prototype._unsubscribe = function(sub) {
  return this.subscriptionCollection.findOneAndDelete({
    topic: sub.topic,
    callbackUrl: sub.callbackUrl,
    protocol: sub.protocol
  })
}

/**
 *
 *
 * @param {any} topic
 * @param {any} callbackUrl
 * @returns
 */
WebSubHub.prototype._isDuplicateSubscription = async function(sub) {
  const entry = await this.subscriptionCollection.findOne({
    topic: sub.topic,
    callbackUrl: sub.callbackUrl,
    protocol: sub.protocol
  })

  if (entry !== null) {
    return true
  }

  return false
}

/**
 *
 *
 * @param {any} subscription
 * @param {any} cb
 * @returns
 */
WebSubHub.prototype._createSubscription = async function(subscription) {
  const isDuplicate = await this._isDuplicateSubscription(subscription)

  if (isDuplicate === false) {
    try {
      const currentDate = new Date()
      // create new subscription
      await this.subscriptionCollection.insertOne({
        mode: subscription.mode,
        callbackUrl: subscription.callbackUrl,
        callbackQuery: subscription.callbackQuery,
        topic: subscription.topic,
        topicQuery: subscription.topicQuery,
        leaseSeconds: subscription.leaseSeconds,
        leaseEndAt: new Date(Date.now() + subscription.leaseSeconds * 1000),
        secret: subscription.secret,
        protocol: subscription.protocol,
        format: subscription.format,
        createdAt: currentDate,
        updatedAt: currentDate
      })
    } catch (err) {
      throw Boom.wrap(err, 500, 'subscription could not be created')
    }
  } else {
    try {
      // renew leaseSeconds subscription time
      await this.subscriptionCollection.findOneAndUpdate(
        {
          callbackUrl: subscription.callbackUrl,
          topic: subscription.topic,
          protocol: subscription.protocol
        },
        {
          $set: {
            leaseSeconds: subscription.leaseSeconds,
            updatedAt: new Date(),
            leaseEndAt: new Date(Date.now() + subscription.leaseSeconds * 1000),
            token: subscription.token
          }
        }
      )
    } catch (err) {
      throw Boom.wrap(err, 500, 'Subscription could not be renewed')
    }
  }
}

WebSubHub.prototype._registerHttpHandler = function() {
  this.server.post('/', { schema: Schemas.subscriptionRequest }, (req, resp) =>
    this._handleSubscriptionRequest(req, resp)
  )
  this.server.post(
    '/publish',
    { schema: Schemas.publishingRequest },
    (req, resp) => this._handlePublishRequest(req, resp)
  )
  this.server.get(
    '/subscriptions',
    { schema: Schemas.subscriptionListRequest },
    (req, resp) => this._handleSubscriptionListRequest(req, resp)
  )
}

WebSubHub.prototype.listen = function() {
  return this.server.listen(this.options.port, this.options.address)
}

WebSubHub.prototype.close = function() {
  return this.server.close()
}
