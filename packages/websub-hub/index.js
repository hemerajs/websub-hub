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
const Crypto = require('crypto')
const PEvent = require('p-event')
const Stream = require('stream')
const WebSocket = require('./plugins/websocket')
const PQueue = require('p-queue')
const Utils = require('./lib/utils')
const WS = require('ws')

module.exports = build

const defaultLeaseInSeconds = 864000 // 10 days
const wsMaxPayload = 5 * 1024 * 1024 // 5MB
const wsHandshakeTimeout = 300 // milliseconds
const wsCodes = {
  WSH_INTERNAL_ERROR: 'WSH_INTERNAL_ERROR',
  WSH_SUBSCRIPTION_NOT_EXISTS: 'WSH_SUBSCRIPTION_NOT_EXISTS'
}
const verificationState = {
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
  ws: false,
  mongo: {
    url: '',
    useNewUrlParser: true
  },
  retry: 2
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
  this._publishingQueue = new PQueue({ concurrency: 4 })
  this._wsClients = new Map()

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

  if (this.options.ws) {
    const handle = async (client, req) => {
      const topic = req.headers['x-hub-topic']
      const callback = req.headers['x-hub-callback']

      try {
        const normalizedTopicUrl = Utils.normalizeUrl(topic)
        const topicUrl = normalizedTopicUrl.url

        const normalizedCallback = Utils.normalizeUrl(callback)
        const callbackUrl = normalizedCallback.url

        const exists = await this._subscriptionExists({
          topic: topicUrl,
          callbackUrl
        })

        if (exists === false) {
          this.log.error(
            'cannot open ws connection because subscription does not exists'
          )
          if (client.readyState === WS.OPEN) {
            client.send(
              JSON.stringify({ code: wsCodes.WSH_SUBSCRIPTION_NOT_EXISTS })
            )
          }
          client.terminate()
          return
        }

        const key = this.server.websocketClientKey(topicUrl, callbackUrl)
        this._wsClients.set(key, client)
      } catch (err) {
        this.log.error(err, 'connection could not be accepted')
        if (client.readyState === WS.OPEN) {
          client.send(JSON.stringify({ code: wsCodes.WSH_INTERNAL_ERROR }))
        }
        client.terminate()
      }
    }

    this.server.register(WebSocket, {
      handle,
      perMessageDeflate: false,
      maxPayload: wsMaxPayload,
      handshakeTimeout: wsHandshakeTimeout
    })
  }

  this.httpClient = Got.extend({
    timeout: this.options.timeout,
    retry: this.options.retry
  })
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

WebSubHub.prototype._setupDbIndizes = function() {
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
      `subscription could not be verified '%s', statusCode: %d`,
      callbackUrl,
      err.statusCode
    )
    return verificationState.HTTP_ERROR
  }

  if (
    response.body &&
    response.body['hub.challenge'] &&
    challenge &&
    Utils.safeEqual(response.body['hub.challenge'], challenge)
  ) {
    return verificationState.ACCEPTED
  }

  this.log.error(
    `subscription could not be verified '%s', invalid challenge`,
    callbackUrl
  )

  return verificationState.DECLINED
}

WebSubHub.prototype._distributeContentHTTP = async function(
  sub,
  stream,
  headers
) {
  // must send a X-Hub-Signature header if the subscription was made with a hub.secret
  // https://w3c.github.io/websub/#signing-content
  if (sub.secret) {
    const stream1 = stream.pipe(new Stream.PassThrough())
    const stream2 = stream.pipe(new Stream.PassThrough())

    const hmac = Crypto.createHmac('sha256', sub.secret).setEncoding('hex')
    const hashStream = stream1.pipe(hmac)

    await PEvent(hashStream, 'readable')
    headers['x-hub-signature'] = 'sha256=' + hmac.read()
    return this._sendContentHTTP(sub, stream2, headers)
  }

  return this._sendContentHTTP(sub, stream, headers)
}

WebSubHub.prototype._sendContentHTTP = async function(sub, stream, headers) {
  try {
    const response = this.httpClient.stream.post(sub.callbackUrl, {
      query: sub.callbackQuery,
      headers
    })

    const output = stream.pipe(response)

    await PEvent(output, 'response')
  } catch (err) {
    this.log.error(
      err,
      `content could not be published over HTTP to '%s'`,
      sub.callbackUrl
    )

    throw Boom.badRequest('content could not be published')
  }
}

WebSubHub.prototype._distributeContentWS = function(sub, data, headers) {
  if (sub.secret) {
    const hmac = Crypto.createHmac('sha256', sub.secret)
      .setEncoding('hex')
      .update(data)

    headers['x-hub-signature'] = 'sha256=' + hmac.digest('hex')
    this._sendContentWS(sub, data, headers)
    return
  }

  this._sendContentWS(sub, data, headers)
}

WebSubHub.prototype._sendContentWS = function(sub, data, headers) {
  const key = this.server.websocketClientKey(sub.topic, sub.callbackUrl)

  if (this._wsClients.has(key)) {
    const client = this._wsClients.get(key)
    try {
      const msg = {
        topic: sub.topic,
        headers,
        query: sub.callbackQuery,
        data: JSON.parse(data)
      }
      client.send(JSON.stringify(msg))
    } catch (err) {
      this.log.error(
        err,
        `content could not be send over WS to '%s'`,
        sub.callbackUrl
      )
    }
  }
}

WebSubHub.prototype._handlePublishRequest = async function(req, reply) {
  const topicUrl = req.body['hub.url']

  const cursor = await this.subscriptionCollection.find({
    topic: topicUrl
  })

  const mapper = async sub => {
    try {
      const headers = {}

      if (sub.format === 'json') {
        headers['content-type'] = 'application/json'
      } else if (sub.format === 'xml') {
        headers['content-type'] = 'application/xml'
      }

      // The request MUST include at least one Link Header [RFC5988] with rel=hub pointing to a Hub associated with the topic being updated.
      // It MUST also include one Link Header [RFC5988] with rel=self set to the canonical URL of the topic being updated.
      headers.link = `<${this._getHubUrl()}>; rel="hub", <${
        sub.topic
      }>; rel="self"`

      if (sub.ws === true) {
        const response = await this._fetchTopicContent(sub)
        this._distributeContentWS(sub, response.body, headers)
      } else if (sub.protocol === 'http:') {
        const response = await this._fetchTopicContent(sub, true)
        await this._distributeContentHTTP(sub, response, headers)
      }
    } catch (err) {
      this.log.error(
        err,
        `topic content could not be published to subscriber with url '%s'`,
        sub.callbackUrl
      )
    }
  }

  while (await cursor.hasNext()) {
    const sub = await cursor.next()
    this._publishingQueue.add(() => mapper(sub))
  }

  reply.code(200).send()
}

WebSubHub.prototype._fetchTopicContent = async function(sub, stream = false) {
  const headers = {}

  if (sub.format === 'json') {
    headers.accept = 'application/json'
  } else if (sub.format === 'xml') {
    headers.accept = 'application/xml'
  }

  let response = null

  try {
    response = await this.httpClient.get(sub.topic, {
      stream,
      headers,
      throwHttpErrors: false
    })
  } catch (err) {
    this.log.error(err, `from topic '%s' could not be fetched`, sub.topic)
    throw Boom.notFound('from topic could not be fetched')
  }

  return response
}

WebSubHub.prototype._handleSubscriptionRequest = async function(req, reply) {
  const mode = req.body['hub.mode']
  const leaseSeconds = req.body['hub.lease_seconds'] || defaultLeaseInSeconds
  const secret = req.body['hub.secret']
  const format = req.body['hub.format']
  const ws = req.body['hub.ws']
  const challenge = this.hyperid()

  const normalizedTopicUrl = Utils.normalizeUrl(req.body['hub.topic'])
  const topicQuery = normalizedTopicUrl.query
  const topicUrl = normalizedTopicUrl.url

  const normalizedCallbackUrl = Utils.normalizeUrl(req.body['hub.callback'])
  const callbackQuery = normalizedCallbackUrl.query
  const callbackUrl = normalizedCallbackUrl.url
  const protocol = normalizedCallbackUrl.protocol

  const sub = {
    ws,
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

  if (intentResult === verificationState.DECLINED) {
    reply.code(404).send()
    return
  } else if (intentResult === verificationState.HTTP_ERROR) {
    reply.code(404).send()
    return
  }

  this.log.info(`'%s' for callback '%s' was verified`, mode, callbackUrl)

  if (mode === requestMode.SUBSCRIBE) {
    await this._subscribe(sub)
    this.log.info(`subscription for callback '%s' was created`, callbackUrl)
  } else if (mode === requestMode.UNSUBSRIBE) {
    await this._unsubscribe(sub)
    this.log.info(`subscription for callback '%s' was deleted`, callbackUrl)
  } else {
    throw Boom.notImplemented(`mode '${mode}' is not implemented`)
  }

  reply.code(200).send()
}

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

WebSubHub.prototype._unsubscribe = async function(sub) {
  await this.subscriptionCollection.findOneAndDelete({
    topic: sub.topic,
    callbackUrl: sub.callbackUrl
  })

  if (this.options.ws) {
    this._unsubscribeWS(sub)
  }
}

WebSubHub.prototype._unsubscribeWS = async function(sub) {
  const key = this.server.websocketClientKey(sub.topic, sub.callbackUrl)

  if (this._wsClients.has(key)) {
    const ws = this._wsClients.get(key)
    ws.terminate()
    this._wsClients.delete(key)
  }
}

WebSubHub.prototype._subscriptionExists = async function(sub) {
  const entry = await this.subscriptionCollection.findOne({
    leaseEndAt: { $gte: new Date() },
    topic: sub.topic,
    callbackUrl: sub.callbackUrl
  })

  if (entry !== null) {
    return true
  }

  return false
}

WebSubHub.prototype._renewSubscription = function(sub) {
  return this.subscriptionCollection.findOneAndUpdate(
    {
      callbackUrl: sub.callbackUrl,
      topic: sub.topic
    },
    {
      $set: {
        leaseSeconds: sub.leaseSeconds,
        updatedAt: new Date(),
        leaseEndAt: new Date(Date.now() + sub.leaseSeconds * 1000)
      }
    }
  )
}

WebSubHub.prototype._createSubscription = function(sub) {
  const currentDate = new Date()
  return this.subscriptionCollection.insertOne({
    mode: sub.mode,
    callbackUrl: sub.callbackUrl,
    callbackQuery: sub.callbackQuery,
    topic: sub.topic,
    topicQuery: sub.topicQuery,
    leaseSeconds: sub.leaseSeconds,
    leaseEndAt: new Date(Date.now() + sub.leaseSeconds * 1000),
    secret: sub.secret,
    protocol: sub.protocol,
    format: sub.format,
    ws: sub.ws,
    createdAt: currentDate,
    updatedAt: currentDate
  })
}

WebSubHub.prototype._subscribe = async function(sub) {
  const exists = await this._subscriptionExists(sub)

  if (exists === false) {
    try {
      await this._createSubscription(sub)
    } catch (err) {
      throw Boom.wrap(err, 500, 'subscription could not be created')
    }
  } else {
    try {
      await this._renewSubscription(sub)
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
  if (this.options.ws) {
    this.server.websocketServer.close()
  }

  return this.server.close()
}
