'use strict'

const Schemas = require('./lib/schemas')
const Fastify = require('fastify')
const FormBody = require('body/form')
const Axios = require('axios')
const Hyperid = require('hyperid')
const Boom = require('boom')
const Util = require('util')
const Hoek = require('hoek')
const Pino = require('pino')
const Serializer = require('./lib/serializer')
const Promisify = require('es6-promisify')
const EventEmitter = require('events')
const Crypto = require('crypto')

const defaultOptions = {
  name: 'hub',
  requestTimeout: 1000,
  logLevel: 'info',
  hubUrl: 'http://127.0.0.1:3000',
  fastify: {
    logger: {
      level: 'info'
    }
  },
  server: {
    port: 3000
  },
  mongo: {
    url: 'mongodb://localhost:27017/hub'
  }
}

function Server (options) {
  EventEmitter.call(this)

  this.options = Hoek.applyToDefaults(defaultOptions, options || {})
  this.server = Fastify(this.options)
  this.httpClient = Axios.create({
    timeout: this.options.requestTimeout
  })
  this.hyperid = Hyperid()
  this._addContentTypeParser()
  this._createDbConnection()
  this.intentStates = { ACCEPTED: 'accepted', DECLINED: 'declined', UNKNOWN: 'unknown' }
  this.modes = { SUBSCRIBE: 'subscribe', UNSUBSRIBE: 'unsubscribe' }
  this._registerHandlers()

  const pretty = Pino.pretty()
  pretty.pipe(process.stdout)

  this.log = Pino({
    name: this.options.name,
    safe: true, // avoid error caused by circular references
    serializers: Serializer,
    level: this.options.logLevel
  }, pretty)

  if (!(this instanceof Server)) {
    return new Server(options)
  }
}

Util.inherits(Server, EventEmitter)

Server.prototype._createDbConnection = function () {
  this.server.register(require('fastify-mongodb'), this.options.mongo, err => {
    if (err) {
      this.emit('error', err)
    }
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
Server.prototype._addContentTypeParser = function () {
  this.server.addContentTypeParser('application/x-www-form-urlencoded', function (req, done) {
    FormBody(req, (err, body) => {
      done(err || body)
    })
  })
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
Server.prototype._verifyIntent = function (callbackUrl, mode, topic, challenge, cb) {
  return this.httpClient.post(callbackUrl, {
    'hub.topic': topic,
    'hub.mode': mode,
    'hub.challenge': challenge
  })
    .then((response) => {
      if (response.status >= 200 && response.status < 300) {
        if (response.data['hub.challenge'] === challenge) {
          return this.intentStates.ACCEPTED
        }
        return this.intentStates.DECLINED
      } else if (response.status === 404) {
        return this.intentStates.DECLINED
      }
      return this.intentStates.UNKNOWN
    })
    .catch(() => {
      return this.intentStates.UNKNOWN
    })
}

/**
 * The response body from the subscriber must be ignored by the hub.
 * Hubs should retry notifications up to self-imposed limits on the number of times and the overall time period to retry.
 * When the failing delivery exceeds the hub's limits, the hub terminates the subscription.
 *
 * https://w3c.github.io/websub/#h-content-distribution
 */
Server.prototype._distributeContent = function (subscriptions, content) {
  const requests = []
  for (var index = 0; index < subscriptions.length; index++) {
    const sub = subscriptions[index]
    const headers = {}
    // The request must include at least one Link Header
    headers['Link'] = `<${sub.topic}>; rel="self", <${this.options.hubUrl}>; rel="hub"`
    // must send a X-Hub-Signature header if the subscription was made with a hub.secret
    if (sub.secret) {
      headers['X-Hub-Signature'] = Crypto.createHmac('sha256', sub.secret).update(JSON.stringify(content)).digest('hex')
    }
    const request = this.httpClient({
      method: 'post',
      headers,
      url: sub.callbackUrl,
      data: content
    })
    .then((response) => {
      // Ignore http errors
      this.log.debug('Subscription ' + sub._id + ' respond with ' + response.status)
    }).catch((error) => {
      const err = Boom.wrap(error, error.response.status, 'Content could not be send')
      this.log.error({ httpError: err }, 'Content distribution to ' + error.response.config.url)
    })
    requests.push(request)
  }
  return Axios.all(requests)
}

Server.prototype._handlePublishRequest = function (req, reply) {
  const topicUrl = req.body['hub.url']

  const { db } = this.server.mongo
  const subscriptionsCollection = db.collection('subscriptions')

  this._fetchTopicContent(topicUrl)
    .then((content) => {
      return subscriptionsCollection.find({
        topic: topicUrl
      }).toArray().then((subscriptions) => {
        return this._distributeContent(subscriptions, content)
      })
    })
    .then((content) => {
      reply.code(200).send()
    })
    .catch((err) => {
      this.log.error({ httpError: err }, 'Could not handle publishing request')
      reply.code(err.output.statusCode).send(err)
    })
}

Server.prototype._fetchTopicContent = function (topic) {
  return this.httpClient.get(topic).then((response) => {
    return response.data
  })
    .catch((err) => {
      return Promise.reject(Boom.wrap(err, 503, 'Topic endpoint return an invalid answer'))
    })
}

Server.prototype._handleSubscriptionRequest = function (req, reply) {
  const callbackUrl = req.body['hub.callback']
  const mode = req.body['hub.mode']
  const topic = req.body['hub.topic']
  const leaseSeconds = req.body['hub.lease_seconds']
  const secret = req.body['hub.secret']
  const challenge = this.hyperid()

  const { db } = this.server.mongo
  this.subscriptionCollection = db.collection('subscriptions')

  this._verifyIntent(callbackUrl, mode, topic, challenge).then((intent) => {
    if (intent === this.intentStates.DECLINED) {
      return Promise.reject(Boom.forbidden('Subscriber has declined'))
    } else if (intent === this.intentStates.UNKNOWN) {
      return Promise.reject(Boom.forbidden('Subscriber has return an invalid answer'))
    }
  })
  .then(() => {
    if (mode === this.modes.SUBSCRIBE) {
      return this._createSubscription({
        callbackUrl,
        mode,
        topic,
        leaseSeconds,
        secret
      })
    } else {
      return this._unsubscribe(topic, callbackUrl).then((subscription) => {
        if (subscription && subscription.value === null) {
          return Promise.reject(Boom.notFound('Subscription could not be found'))
        }
      })
    }
  })
  .then(x => reply.code(200).send())
  .catch(err => {
    this.log.error({ httpError: err }, `Could not handle ${mode} request`)
    reply.code(err.output.statusCode).send(err)
  })
}

Server.prototype._unsubscribe = function (topic, callbackUrl, cb) {
  return this.subscriptionCollection.findOneAndDelete({
    topic: topic,
    callbackUrl: callbackUrl
  })
  .catch((err) => {
    return Promise.reject(Boom.wrap(err, 500, 'Subscription could not be deleted'))
  })
}

Server.prototype._isDuplicateSubscription = function (topic, callbackUrl) {
  return this.subscriptionCollection.findOne({
    topic: topic,
    callbackUrl: callbackUrl
  }).then((result) => {
    return result !== null
  }).catch((err) => {
    return Promise.reject(Boom.wrap(err, 500, 'Subscription could not be fetched'))
  })
}

Server.prototype._createSubscription = function (subscription, cb) {
  return this._isDuplicateSubscription(subscription.topic, subscription.callbackUrl).then((isDuplicate) => {
    if (isDuplicate === false) {
      // create new subscription
      return this.subscriptionCollection.insertOne({
        callbackUrl: subscription.callbackUrl,
        mode: subscription.mode,
        topic: subscription.topic,
        leaseSeconds: subscription.leaseSeconds,
        secret: subscription.secret,
        createdAt: new Date()
      }).catch((err) => {
        return Promise.reject(Boom.wrap(err, 500, 'Subscription could not be created'))
      })
    } else {
      // renew leaseSeconds subscription time
      return this.subscriptionCollection.findOneAndUpdate({
        callbackUrl: subscription.callbackUrl,
        topic: subscription.topic
      }, {
        $set: {
          leaseSeconds: subscription.leaseSeconds,
          updatedAt: new Date()
        }
      }).catch((err) => {
        return Promise.reject(Boom.wrap(err, 500, 'Subscription could not be created'))
      })
    }
  })
}

Server.prototype._registerHandlers = function () {
  this.server.post('/subscribe', Schemas.subscriptionRequest, (req, resp) => this._handleSubscriptionRequest(req, resp))
  this.server.post('/publish', Schemas.publishingRequest, (req, resp) => this._handlePublishRequest(req, resp))
}

Server.prototype.listen = function () {
  return Promisify(this.server.listen, { thisArg: this.server })(this.options.server)
}

Server.prototype.close = function (cb) {
  return Promisify(this.server.close, { thisArg: this.server })()
}

module.exports = Server
