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

const defaultOptions = {
  name: 'hub',
  logLevel: 'info',
  fastify: {
    logger: {
      level: 'info'
    }
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
    timeout: 1000
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
      if (response.status === 200 && response.data['hub.challenge'] === challenge) {
        return this.intentStates.ACCEPTED
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
 * When perfoming discovery, subscribers must implement all three discovery mechanisms in the following order, stopping at the first match:
 * 1. Issue a GET or HEAD request to retrieve the topic URL. Subscribers must check for HTTP Link headers first.
 * 2. In the absence of HTTP Link headers, and if the topic is an XML based feed or an HTML page, subscribers must check for embedded link elements.
 * 3. In the absence of both HTTP Link headers and embedded link elements, subscribers must look in the Host-Meta Well-Known URI [RFC6415] /.well-known/host-meta for the <Link> element with rel="hub".
 * However, please note that this mechanism is currently At Risk and may be deprecated.
 * @memberof Server
 */
Server.prototype._discover = function (url) {
  return this.httpClient.get(url)
}

/**
 * Link Headers [RFC5988]: the publisher should include at least one Link Header [RFC5988] with rel=hub (a hub link header) as well as exactly one Link Header [RFC5988] with rel=self (the self link header)
 *
 * Example: https://documentation.superfeedr.com/publishers.html
 *
 * @memberof Server
 */
Server.prototype._checkInLinkHeaders = function () {}
/**
 * If the topic is an XML based feed, publishers should use embedded link elements as described in Appendix B of Web Linking [RFC5988].
 * Similarly, for HTML pages, publishers should use embedded link elements as described in Appendix A of Web Linking [RFC5988].
 * However, for HTML, these <link> elements must be only present in the <head> section of the HTML document. (Note: The restriction on limiting <link> to the <head> is At Risk.)
 *
 * Example: https://documentation.superfeedr.com/publishers.html
 *
 * @memberof Server
 */
Server.prototype._checkInRSSFeed = function () {}
/**
 * If the topic is an XML based feed, publishers should use embedded link elements as described in Appendix B of Web Linking [RFC5988].
 * Similarly, for HTML pages, publishers should use embedded link elements as described in Appendix A of Web Linking [RFC5988].
 * However, for HTML, these <link> elements must be only present in the <head> section of the HTML document. (Note: The restriction on limiting <link> to the <head> is At Risk.)
 *
 * Example: https://documentation.superfeedr.com/publishers.html
 *
 * @memberof Server
 */
Server.prototype._checkInATOMFeed = function () {}

Server.prototype._handlePublishingRequest = function (req, reply) {}

Server.prototype._handlePublishRequest = function (req, reply) {
  const topicUrl = req.body['hub.url']

  const { db } = this.server.mongo
  this.topicCollection = db.collection('topics')
  this.topicCollection.findOne({
    topic: topicUrl
  })
    .then((topic) => {
      if (topic) {
        return this._fetchTopicContent(topicUrl)
      }
      return Promise.reject(Boom.notFound('Topic could not be found'))
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

  const { db } = this.server.mongo
  this.subscriptionCollection = db.collection('subscriptions')
  this.topicCollection = db.collection('topics')

  if (mode === this.modes.SUBSCRIBE) {
    this._verifyIntent(callbackUrl, mode, topic, this.hyperid()).then((intent) => {
      if (intent === this.intentStates.ACCEPTED) {
        return this._createTopic(topic).then(() => {
          return this._createSubscription({
            callbackUrl,
            mode,
            topic,
            leaseSeconds,
            secret: secret
          })
        })
      } else if (intent === this.intentStates.DECLINED) {
        return Promise.reject(Boom.forbidden('Subscriber has declined'))
      } else if (intent === this.intentStates.UNKNOWN) {
        return Promise.reject(Boom.forbidden('Subscriber has return an invalid answer'))
      }
    })
      .then(() => reply.code(200).send())
      .catch((err) => {
        this.log.error({ httpError: err }, 'Could not handle subscription request')
        reply.code(err.output.statusCode).send(err)
      })
  } else {
    this._unsubscribe(topic, callbackUrl)
      .then(() => reply.code(200).send())
      .catch((err) => {
        this.log.error({ httpError: err }, 'Could not handle unsubscription request')
        reply.code(err.output.statusCode).send(err)
      })
  }
}

Server.prototype._unsubscribe = function (topic, callbackUrl, cb) {
  return this.subscriptionCollection.findOneAndDelete({
    topic: topic,
    callbackUrl: callbackUrl
  }).then((result) => {
    return result.value
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

Server.prototype._isDuplicateTopic = function (topic, cb) {
  return this.topicCollection.findOne({
    topic: topic
  }).then((result) => {
    return result !== null
  }).catch((err) => {
    return Promise.reject(Boom.wrap(err, 500, 'Topic could not be fetched'))
  })
}

Server.prototype._createTopic = function (topic) {
  return this._isDuplicateTopic(topic).then((isDuplicate) => {
    if (isDuplicate === false) {
      return this.topicCollection.insertOne({
        topic: topic
      }).catch((err) => {
        return Promise.reject(Boom.wrap(err, 500, 'Topic could not be created'))
      })
    }
  })
}

Server.prototype._createSubscription = function (subscription, cb) {
  return this._isDuplicateSubscription(subscription.topic, subscription.callbackUrl).then((isDuplicate) => {
    if (isDuplicate === false) {
      return this.subscriptionCollection.insertOne({
        callbackUrl: subscription.callbackUrl,
        mode: subscription.mode,
        topic: subscription.topic,
        lease_seconds: subscription.leaseSeconds,
        secret: subscription.secret
      }).catch((err) => {
        return Promise.reject(Boom.wrap(err, 500, 'Subscription could not be created'))
      })
    } else {
      return Promise.reject(Boom.forbidden('Subscriber is already subscribed'))
    }
  })
}

Server.prototype._registerHandlers = function () {
  this.server.post('/subscribe', Schemas.subscriptionRequest, (req, resp) => this._handleSubscriptionRequest(req, resp))
  this.server.post('/publish', Schemas.publishingRequest, (req, resp) => this._handlePublishRequest(req, resp))
}

Server.prototype.listen = function (opt) {
  return Promisify(this.server.listen, { thisArg: this.server })(opt)
}

Server.prototype.close = function (cb) {
  return Promisify(this.server.close, { thisArg: this.server })()
}

module.exports = Server
