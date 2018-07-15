'use strict'

const Schemas = require('./schemas')
const Fastify = require('fastify')
const FormBody = require('fastify-formbody')
const FastifyBoom = require('fastify-boom')
const Mongodb = require('fastify-mongodb')
const Got = require('got')
const Hyperid = require('hyperid')
const Boom = require('boom')
const Hoek = require('hoek')
const Pino = require('pino')
const Serializer = require('./serializer')
const safeEqual = require('./safeEqual')
const Crypto = require('crypto')
const JSONStream = require('JSONStream')
const PEvent = require('p-event')
const GetStream = require('get-stream')
const MimeTypes = require('mime-types')
const PMap = require('p-map')
const Sax = require('sax')

module.exports = Server

const defaultOptions = {
  name: 'hub',
  port: 3000,
  address: '127.0.0.1',
  timeout: 2000,
  logLevel: 'error',
  hubUrl: 'http://127.0.0.1:3000',
  collection: 'subscriptions',
  jwt: {
    secret: '',
    options: {}
  },
  fastify: {
    logger: {
      level: 'error'
    }
  },
  mongo: {
    url: ''
  },
  retries: 3
}

/**
 *
 *
 * @param {any} options
 * @returns
 */
function Server(options) {
  this.options = Hoek.applyToDefaults(defaultOptions, options || {})

  this.server = Fastify(this.options)
  this.server.register(FastifyBoom)
  this.server.register(FormBody)
  this.server.register(Mongodb, this.options.mongo).after(() => {
    const { db } = this.server.mongo
    this.subscriptionCollection = db.collection(this.options.collection)
  })

  this.httpClient = Got
  this.hyperid = Hyperid()
  this.intentStates = {
    ACCEPTED: 'accepted',
    DECLINED: 'declined',
    UNKNOWN: 'unknown'
  }
  this.modes = {
    SUBSCRIBE: 'subscribe',
    UNSUBSRIBE: 'unsubscribe'
  }
  this._registerHandlers()

  const pretty = Pino.pretty()
  pretty.pipe(process.stdout)

  this.log = Pino(
    {
      name: this.options.name,
      safe: true, // avoid error caused by circular references
      serializers: Serializer,
      level: this.options.logLevel
    },
    pretty
  )

  if (!(this instanceof Server)) {
    return new Server(options)
  }
}

/**
 * The hub verifies a subscription request by sending an HTTP [RFC7231] GET request to the subscriber's callback URL as given in the subscription request.
 * The subscriber must confirm that the hub.topic corresponds to a pending subscription or unsubscription that it wishes to carry out.
 * If so, the subscriber must respond with an HTTP success (2xx) code with a response body equal to the hub.challenge parameter.
 * If the subscriber does not agree with the action, the subscriber must respond with a 404 "Not Found" response.
 *
 * @param {any} callbackUrl
 * @param {any} mode
 * @param {any} topic
 * @param {any} challenge
 * @param {any} cb
 *
 * @memberof Server
 */
Server.prototype._verifyIntent = async function(
  callbackUrl,
  mode,
  topic,
  challenge,
  cb
) {
  let response
  try {
    response = await this.httpClient.get(callbackUrl, {
      retries: this.options.retries,
      json: true,
      query: {
        'hub.topic': topic,
        'hub.mode': mode,
        'hub.challenge': challenge
      }
    })
  } catch (_) {
    return this.intentStates.UNKNOWN
  }

  if (
    response.body['hub.challenge'] &&
    challenge &&
    safeEqual(response.body['hub.challenge'], challenge)
  ) {
    return this.intentStates.ACCEPTED
  }

  return this.intentStates.DECLINED
}

/**
 *
 *
 * @param {any} sub
 * @param {any} content
 * @returns
 */
Server.prototype._distributeContentHttp = async function(sub, content) {
  const headers = {}

  if (sub.format === 'json') {
    headers['Content-Type'] = 'application/json'
  } else {
    headers['Content-Type'] = 'application/rss+xml'
  }

  // must send a X-Hub-Signature header if the subscription was made with a hub.secret
  if (sub.secret) {
    const streamContent = await GetStream(content.stream)
    headers['X-Hub-Signature'] = Crypto.createHmac('sha256', sub.secret)
      .update(streamContent)
      .digest('hex')

    try {
      await this.httpClient.post(sub.callbackUrl, {
        body: streamContent,
        retries: this.options.retries,
        headers
      })
    } catch (err) {
      // swallow
      this.log.error(
        err,
        `Content could not be published to '%s'`,
        sub.callbackUrl
      )
    }
  } else {
    const stream = content.stream.pipe(
      this.httpClient.stream.post(sub.callbackUrl, {
        retries: this.options.retries,
        headers
      })
    )
    return new Promise((resolve, reject) => {
      stream.once('response', _ => resolve())
      stream.once('error', err => {
        this.log.error(
          err,
          `Content could not be published to '%s'`,
          sub.callbackUrl
        )
        // swallow
        resolve()
      })
    })
  }
}

/**
 *
 *
 * @param {any} req
 * @param {any} reply
 */
Server.prototype._handlePublishRequest = async function(req, reply) {
  const topicUrl = req.body['hub.url']

  const { db } = this.server.mongo
  this.subscriptionsCollection = db.collection('subscriptions')

  const subscriptions = await this.subscriptionsCollection
    .find({
      topic: topicUrl
    })
    .toArray()

  const mapper = async sub => {
    const content = await this._fetchTopicContent(sub)
    return this._distributeContentHttp(sub, content)
  }

  try {
    await PMap(subscriptions, mapper, { concurrency: 4 })
  } catch (err) {
    this.log.error(err, 'Could not fetch and distribute content')
    reply.send(err)
    return
  }

  reply.code(200).send()
}

/**
 *
 * @TODO support streaming
 * @param {any} topic
 * @returns
 */
Server.prototype._fetchTopicContent = async function(sub) {
  const headers = {}

  if (sub.format === 'json') {
    headers.Accept = 'application/json'
  } else {
    headers.Accept = 'application/rss+xml'
  }

  let stream = null

  try {
    stream = await this.httpClient.get(sub.topic, {
      stream: true,
      retries: this.options.retries,
      headers
    })
  } catch (err) {
    this.log.error(err, `From topic '%s' could not be fetched`, sub.topic)
    throw Boom.notFound('From topic could not be fetched')
  }

  let contentType = 'json'

  const response = await PEvent(stream, 'response')

  if (response.headers) {
    contentType = MimeTypes.extension(response.headers['Content-Type'])
  }

  const updated = await this._getUpdatedDate(stream, contentType)

  return {
    updated,
    stream,
    contentType
  }
}

Server.prototype._getUpdatedDate = async function(stream, contentType) {
  if (contentType === 'json') {
    return this._parseJSONUpdateDate(stream)
  } else if (contentType === 'xml' || contentType === 'rss') {
    return this._parseXMLUpdateDate(stream)
  }
}

Server.prototype._parseJSONUpdateDate = function(stream) {
  return new Promise(resolve => {
    const jsonParser = JSONStream.parse('updated')
    const parser = stream.pipe(jsonParser)
    parser.on('data', function(text) {
      resolve(new Date(text))
      parser.destroy()
    })
  })
}

Server.prototype._parseXMLUpdateDate = function(stream) {
  return new Promise(resolve => {
    let onUpdatedField = false
    let abort = false
    const xmlParser = Sax.createStream()
    stream.pipe(xmlParser)
    xmlParser.onopentag = function(name) {
      if (name === 'updated') {
        onUpdatedField = true
      }
    }
    xmlParser.ontext = function(text) {
      if (onUpdatedField && abort === false) {
        xmlParser.end()
        abort = true
        resolve(new Date(text))
      }
    }
  })
}

/**
 *
 *
 * @param {any} req
 * @param {any} reply
 */
Server.prototype._handleSubscriptionRequest = async function(req, reply) {
  const callbackUrl = req.body['hub.callback']
  const mode = req.body['hub.mode']
  const topic = req.body['hub.topic']
  const leaseSeconds = req.body['hub.lease_seconds']
  const secret = req.body['hub.secret']
  const format = req.body['hub.format'] || 'json'
  const protocol = 'http'
  const challenge = this.hyperid()

  const sub = {
    mode,
    callbackUrl,
    topic,
    leaseSeconds,
    secret,
    protocol,
    format
  }

  const intentResult = await this._verifyIntent(
    sub.callbackUrl,
    sub.mode,
    sub.topic,
    challenge
  )

  if (intentResult === this.intentStates.DECLINED) {
    reply.send(Boom.forbidden('Subscriber has declined'))
    return
  } else if (intentResult === this.intentStates.UNKNOWN) {
    reply.send(Boom.forbidden('Subscriber could not be verified'))
    return
  }

  this.log.info(`'%s' for callback '%s' was verified`, mode, callbackUrl)

  if (mode === this.modes.SUBSCRIBE) {
    await this._createSubscription(sub)
    this.log.info(
      `subscription for callback '%s' was created`,
      mode,
      callbackUrl
    )
  } else {
    await this._unsubscribe(sub)
    this.log.info(
      `subscription for callback '%s' was unsubscribed`,
      mode,
      callbackUrl
    )
  }

  reply.code(200).send()
}

/**
 *
 * @param {*} req
 * @param {*} reply
 */
Server.prototype._getAllActiveSubscription = function(req, reply) {
  try {
    const cursor = this.subscriptionCollection.find({})
    cursor.project({
      secret: 0
    })
    return cursor.toArray()
  } catch (err) {
    throw Boom.wrap(err, 500, 'Subscription could get all active subscriptions')
  }
}

/**
 *
 *
 * @param {any} req
 * @param {any} reply
 */
Server.prototype._handleSubscriptionListRequest = async function(req, reply) {
  const list = await this._getAllActiveSubscription()
  reply.code(200).send(list)
}

/**
 *
 *
 * @param {any} topic
 * @param {any} callbackUrl
 * @returns
 */
Server.prototype._unsubscribe = function(sub) {
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
Server.prototype._isDuplicateSubscription = async function(sub) {
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
Server.prototype._createSubscription = async function(subscription) {
  const isDuplicate = await this._isDuplicateSubscription(subscription)

  if (isDuplicate === false) {
    try {
      // create new subscription
      await this.subscriptionCollection.insertOne({
        callbackUrl: subscription.callbackUrl,
        mode: subscription.mode,
        topic: subscription.topic,
        leaseSeconds: subscription.leaseSeconds,
        secret: subscription.secret,
        protocol: subscription.protocol,
        token: subscription.token,
        format: subscription.format,
        createdAt: new Date()
      })
    } catch (err) {
      throw Boom.wrap(err, 500, 'Subscription could not be created')
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
            token: subscription.token
          }
        }
      )
    } catch (err) {
      throw Boom.wrap(err, 500, 'Subscription could not be created')
    }
  }
}

Server.prototype._registerHandlers = function() {
  this.server.post('/', Schemas.subscriptionRequest, (req, resp) =>
    this._handleSubscriptionRequest(req, resp)
  )
  this.server.post('/publish', Schemas.publishingRequest, (req, resp) =>
    this._handlePublishRequest(req, resp)
  )
  this.server.get('/subscriptions', (req, resp) =>
    this._handleSubscriptionListRequest(req, resp)
  )
}

Server.prototype.listen = function() {
  return this.server.listen(this.options.port, this.options.address)
}

Server.prototype.close = function() {
  return this.server.close()
}
