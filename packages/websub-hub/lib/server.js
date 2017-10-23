'use strict'

const Schemas = require('./schemas')
const Fastify = require('fastify')
const FormBody = require('body/form')
const Axios = require('axios')
const Hyperid = require('hyperid')
const Boom = require('boom')
const Util = require('util')
const Hoek = require('hoek')
const Pino = require('pino')
const Serializer = require('./serializer')
const Promisify = require('util').promisify
const Crypto = require('crypto')
const Jwt = require('jsonwebtoken')
const PromiseRetry = require('promise-retry')
const Url = require('url')
const JSONStream = require('JSONStream')
const MimeTypes = require('mime-types')
const Expat = require('node-expat')

const defaultOptions = {
  name: 'hub',
  port: 3000,
  address: '127.0.0.1',
  timeout: 2000,
  logLevel: 'fatal',
  hubUrl: 'http://127.0.0.1:3000',
  jwt: {
    secret: '',
    options: {}
  },
  fastify: {
    logger: {
      level: 'fatal'
    }
  },
  mongo: {
    url: ''
  },
  retry: {
    retries: 5,
    factor: 2,
    minTimeout: 1000,
    maxTimeout: 20000,
    randomize: true
  }
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
  this.httpClient = Axios.create({
    timeout: this.options.timeout
  })
  this.hyperid = Hyperid()
  this._addContentTypeParser()
  this._createDbConnection()
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

Server.prototype._createDbConnection = function() {
  // register mongodb
  this.server
    .register(require('fastify-mongodb'), this.options.mongo)
    .after(err => {
      if (err) {
        this.log.error(err, 'Could not connect to Mongodb')
        return
      }
      const { db } = this.server.mongo
      this.subscriptionCollection = db.collection('subscriptions')
    })
}

/**
 * Subscription is initiated by the subscriber making an HTTPS or HTTP POST [RFC7231] request to the hub URL.
 * This request must have a Content-Type header of application/x-www-form-urlencoded (described in Section 4.10.22.6 [HTML5]),
 * must use UTF-8 [Encoding] as the document character encoding.
 *
 *
 * @memberof Server
 */
Server.prototype._addContentTypeParser = function() {
  this.server.addContentTypeParser(
    'application/x-www-form-urlencoded',
    function(req, done) {
      FormBody(req, (err, body) => {
        done(err || body)
      })
    }
  )
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
Server.prototype._verifyIntent = function(
  callbackUrl,
  mode,
  topic,
  challenge,
  cb
) {
  return this.httpClient
    .post(callbackUrl, {
      'hub.topic': topic,
      'hub.mode': mode,
      'hub.challenge': challenge
    })
    .then(response => {
      if (response.data['hub.challenge'] === challenge) {
        return this.intentStates.ACCEPTED
      }
      return this.intentStates.DECLINED
    })
    .catch(() => {
      return this.intentStates.UNKNOWN
    })
}

/**
 *
 *
 * @param {any} sub
 * @param {any} content
 * @returns
 */
Server.prototype._distributeContentHttp = function(sub, content) {
  const headers = {}
  // must send a X-Hub-Signature header if the subscription was made with a hub.secret
  if (sub.secret) {
    headers['X-Hub-Signature'] = Crypto.createHmac('sha256', sub.secret)
      .update(JSON.stringify(content))
      .digest('hex')
  }

  return PromiseRetry((retry, number) => {
    this.log.debug('Attempt number %s for Sub: %s', number, sub._id)

    return this.httpClient({
      method: 'post',
      headers,
      url: sub.callbackUrl,
      data: content.stream
    }).catch(retry)
  }, this.options.retry)
    .then(response =>
      this.log.debug('Sub: %s respond with %s', sub._id, response.status)
    )
    .catch(error => {
      const err = Boom.wrap(error, error.response.status)
      this.log.debug(
        {
          httpError: err
        },
        'Subscription: %s was canceled',
        sub._id
      )

      // remove subscription and ignore http errors to don't break the batch request
      this._cancelSubscription(sub)
    })
}

/**
 *
 *
 * @param {any} subscription
 * @returns
 */
Server.prototype._cancelSubscription = function(subscription) {
  return this.subscriptionCollection
    .findOneAndDelete({
      callbackUrl: subscription.callbackUrl,
      topic: subscription.topic,
      protocol: subscription.protocol
    })
    .catch(error => {
      this.log.error(
        {
          internalError: error
        },
        'Subscription could not be deleted'
      )
    })
}

/**
 *
 *
 * @param {any} req
 * @param {any} reply
 */
Server.prototype._handlePublishRequest = function(req, reply) {
  const topicUrl = req.body['hub.url']

  const { db } = this.server.mongo
  this.subscriptionsCollection = db.collection('subscriptions')

  return this.subscriptionsCollection
    .find({
      topic: topicUrl
    })
    .toArray()
    .then(subscriptions => {
      const requests = []
      subscriptions.forEach(sub => {
        requests.push(
          this._fetchTopicContent(sub).then(content => {
            return this._distributeContentHttp(sub, content)
          })
        )
      })
      return Promise.all(requests)
    })
    .then(content => {
      reply.code(200).send()
    })
    .catch(err => {
      this.log.error(err)
      reply.code(err.output.statusCode).send(err)
    })
}

/**
 *
 * @TODO support streaming
 * @param {any} topic
 * @returns
 */
Server.prototype._fetchTopicContent = function(sub) {
  const headers = {}

  if (sub.format === 'json') {
    headers.Accept = 'application/json'
  } else {
    headers.Accept = 'application/rss+xml'
  }

  return this.httpClient({
    method: 'get',
    url: sub.topic,
    responseType: 'stream',
    headers
  })
    .then(response => {
      const stream = response.data

      let contentType = 'json'
      // check content type
      if (response.headers) {
        contentType = MimeTypes.extension(response.headers['Content-Type'])
      }

      return this._getUpdatedDate(stream, contentType).then(updated => {
        return {
          updated,
          stream,
          contentType
        }
      })
    })
    .catch(error => {
      this.log.error(error)
      return Promise.reject(Boom.wrap(error, error.response.status))
    })
}

Server.prototype._getUpdatedDate = function(stream, contentType) {
  return new Promise((resolve, reject) => {
    if (contentType === 'json') {
      const jsonParser = JSONStream.parse('updated')
      const parser = stream.pipe(jsonParser)
      parser.on('data', function(text) {
        resolve(new Date(text))
        parser.destroy()
      })
    } else if (contentType === 'xml' || contentType === 'rss') {
      let onUpdatedField = false
      let abort = false
      const xmlParser = Expat.createParser()
      const parser = stream.pipe(xmlParser)
      parser.on('startElement', function(name, attrs) {
        if (name === 'updated') {
          onUpdatedField = true
        }
      })
      parser.on('text', function(text) {
        if (onUpdatedField && abort === false) {
          resolve(new Date(text))
          parser.destroy()
          abort = true
        }
      })
    }
  })
}
/**
 *
 *
 * @param {any} req
 * @param {any} reply
 */
Server.prototype._handleSubscriptionRequest = function(req, reply) {
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

  this._verifyIntent(sub.callbackUrl, sub.mode, sub.topic, challenge)
    .then(intent => {
      if (intent === this.intentStates.DECLINED) {
        return Promise.reject(Boom.forbidden('Subscriber has declined'))
      } else if (intent === this.intentStates.UNKNOWN) {
        return Promise.reject(
          Boom.forbidden('Subscriber has return an invalid answer')
        )
      }
    })
    .then(() => {
      this.log.info('Intent: %s for callback %s verified', mode, callbackUrl)
      if (mode === this.modes.SUBSCRIBE) {
        return this._createSubscription(sub)
      } else {
        return this._unsubscribe(sub)
      }
    })
    .then(x => reply.code(200).send())
    .catch(err => {
      reply.code(err.output.statusCode).send(err)
    })
}

Server.prototype._getAllActiveSubscription = function(req, reply) {
  const cursor = this.subscriptionCollection.find({})
  cursor.project({
    secret: 0
  })

  return cursor.toArray()
}

/**
 *
 *
 * @param {any} req
 * @param {any} reply
 */
Server.prototype._handleSubscriptionListRequest = function(req, reply) {
  reply.code(200).send(this._getAllActiveSubscription())
}

/**
 *
 *
 * @param {any} topic
 * @param {any} callbackUrl
 * @returns
 */
Server.prototype._unsubscribe = function(sub) {
  return this.subscriptionCollection
    .findOneAndDelete({
      topic: sub.topic,
      callbackUrl: sub.callbackUrl,
      protocol: sub.protocol
    })
    .catch(err => {
      return Promise.reject(
        Boom.wrap(err, 500, 'Subscription could not be deleted')
      )
    })
}

/**
 *
 *
 * @param {any} topic
 * @param {any} callbackUrl
 * @returns
 */
Server.prototype._isDuplicateSubscription = function(sub) {
  return this.subscriptionCollection
    .findOne({
      topic: sub.topic,
      callbackUrl: sub.callbackUrl,
      protocol: sub.protocol
    })
    .then(result => {
      return result !== null
    })
    .catch(err => {
      return Promise.reject(
        Boom.wrap(err, 500, 'Subscription could not be fetched')
      )
    })
}

/**
 *
 *
 * @param {any} subscription
 * @param {any} cb
 * @returns
 */
Server.prototype._createSubscription = function(subscription, cb) {
  return this._isDuplicateSubscription(subscription).then(isDuplicate => {
    if (isDuplicate === false) {
      // create new subscription
      return this.subscriptionCollection
        .insertOne({
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
        .catch(err => {
          return Promise.reject(
            Boom.wrap(err, 500, 'Subscription could not be created')
          )
        })
    } else {
      // renew leaseSeconds subscription time
      return this.subscriptionCollection
        .findOneAndUpdate(
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
        .catch(err => {
          return Promise.reject(
            Boom.wrap(err, 500, 'Subscription could not be created')
          )
        })
    }
  })
}

Server.prototype._registerHandlers = function() {
  this.server.post('/subscribe', Schemas.subscriptionRequest, (req, resp) =>
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
  return Promisify(this.server.listen, {
    thisArg: this.server
  })(this.options.port, this.options.address)
}

Server.prototype.close = function() {
  return Promisify(this.server.close, {
    thisArg: this.server
  })()
}

module.exports = Server
