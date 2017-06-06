'use strict'

const Schemas = require('./lib/schemas')
const Fastify = require('fastify')
const FormBody = require('body/form')
const Axios = require('axios')
const Hyperid = require('hyperid')
const Boom = require('boom')
const Util = require('util')
const Promisify = require('es6-promisify')
const EventEmitter = require('events')

const defaultOptions = {
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

  this.options = options || {}
  this.server = Fastify(Object.assign(this.options, defaultOptions))
  this.httpClient = Axios.create({
    timeout: 1000
  })
  this.hyperid = Hyperid()
  this._addContentTypeParser()
  this._createDbConnection()
  this.intentStates = { ACCEPTED: 'accepted', DECLINED: 'declined', UNKNOWN: 'unknown' }
  this.modes = { SUBSCRIBE: 'subscribe', UNSUBSRIBE: 'unsubscribe' }
  this._registerHandlers()

  if (!(this instanceof Server)) {
    return new Server(options)
  }

  this.emit('dedede')
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
/**
 *
 *
 * @param {any} req
 * @param {any} res
 *
 * @memberof Server
 */
Server.prototype._handlePublishingRequest = function (req, res) {}

/**
   *
   *
   * @param {any} req
   * @param {any} res
   *
   * @memberof Server
   */
Server.prototype._handleSubscriptionRequest = function (req, reply) {
  const callbackUrl = req.body['hub.callback']
  const mode = req.body['hub.mode']
  const topic = req.body['hub.topic']
  const leaseSeconds = req.body['hub.lease_seconds']
  const secret = req.body['hub.secret']

  const { db } = this.server.mongo
  this.subscriptionCollection = db.collection('subscriptions')

  if (mode === this.modes.SUBSCRIBE) {
    this._verifyIntent(callbackUrl, mode, topic, this.hyperid()).then((intent) => {
      if (intent === this.intentStates.ACCEPTED) {
        return this._isDuplicateSubscription(topic)
      } else if (intent === this.intentStates.DECLINED) {
        return Promise.reject(Boom.forbidden('Subscriber has declined'))
      } else if (intent === this.intentStates.UNKNOWN) {
        return Promise.reject(Boom.forbidden('Subscriber has return an invalid answer'))
      }
    })
      .then((duplicateRes) => {
        if (duplicateRes) {
          return Promise.reject(Boom.badRequest('Subscriber was already registered'))
        }
        return Promise.resolve()
      })
      .then(() => {
        return this._createSubscription({
          callbackUrl,
          mode,
          topic,
          leaseSeconds,
          secret: secret
        })
      })
      .then(() => reply.code(200).send())
      .catch((err) => reply.code(err.output.statusCode).send(err))
  } else {
    this._unsubscribe(topic, callbackUrl)
      .then(() => {
        reply.code(200).send()
      })
      .catch(() => {
        reply.code(400).send()
      })
  }
}

/**
 *
 *
 * @param {any} topic
 * @param {any} callbackUrl
 * @param {any} cb
 *
 * @memberof Server
 */
Server.prototype._unsubscribe = function (topic, callbackUrl, cb) {
  return this.subscriptionCollection.findOneAndDelete({
    topic: topic,
    callbackUrl: callbackUrl
  }).then((result) => {
    return result.value
  })
    .catch(() => {
      return Promise.reject(Boom.badImplementation('Subscription could not be deleted'))
    })
}

/**
 *
 *
 * @param {any} topic
 * @param {any} cb
 *
 * @memberof Server
 */
Server.prototype._isDuplicateSubscription = function (topic, callbackUrl, cb) {
  return this.subscriptionCollection.findOne({
    topic: topic,
    callbackUrl: callbackUrl
  }).then((result) => {
    return result !== null
  }).catch(() => {
    return Promise.reject(Boom.notFound('Susbcription could not be found'))
  })
}
/**
 *
 *
 * @param {any} subscription
 * @param {any} cb
 *
 * @memberof Server
 */
Server.prototype._createSubscription = function (subscription, cb) {
  return this.subscriptionCollection.insertOne({
    callbackUrl: subscription.callbackUrl,
    mode: subscription.mode,
    topic: subscription.topic,
    lease_seconds: subscription.leaseSeconds,
    secret: subscription.secret
  }).catch(() => {
    return Promise.reject(Boom.badImplementation('Subscription could not be created'))
  })
}

/**
 *
 *
 *
 * @memberof Server
 */
Server.prototype._registerHandlers = function () {
  this.server.post('/subscribe', Schemas.subscriptionRequest, (req, resp) => this._handleSubscriptionRequest(req, resp))
  this.server.post('/publisher/discover', Schemas.publishingRequest, (req, resp) => this._handlePublishingRequest(req, resp))
}

/**
 *
 *
 *
 * @memberof Server
 */
Server.prototype.listen = function (opt) {
  return Promisify(this.server.listen, { thisArg: this.server })(opt)
}

/**
 *
 *
 *
 * @memberof Server
 */
Server.prototype.close = function (cb) {
  return Promisify(this.server.close, { thisArg: this.server })()
}

module.exports = Server
