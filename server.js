'use strict'

const Schemas = require('./lib/schemas')
const Fastify = require('fastify')
const FormBody = require('body/form')
const Async = require('async')
const Request = require('request')
const Hyperid = require('hyperid')
const Boom = require('boom')
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

class Server extends EventEmitter {
  /**
   * Creates an instance of Server.
   *
   * @memberof Server
   */
  constructor (options) {
    super()
    this.options = options || {}
    this.server = Fastify(Object.assign(this.options, defaultOptions))
    this.hyperid = Hyperid()
    this._addContentTypeParser()
    this._createDbConnection()
    this.intentStates = { ACCEPTED: 'accepted', DECLINED: 'declined', UNKNOWN: 'unknown' }
    this.modes = { SUBSCRIBE: 'subscribe', UNSUBSRIBE: 'unsubscribe' }

    this._registerHandlers()
  }

  /**
   *
   *
   *
   * @memberof Server
   */
  _createDbConnection () {
    this.server.register(require('fastify-mongodb'), this.options.mongo, err => {
      if (err) throw err
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
  _addContentTypeParser () {
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
  _verifyIntent (callbackUrl, mode, topic, challenge, cb) {
    const opt = {
      url: callbackUrl,
      form: {
        'hub.topic': topic,
        'hub.mode': mode,
        'hub.challenge': challenge
      }
    }

    Request.post(opt, (err, httpResponse, body) => {
      if (err) {
        return cb(null, { state: this.intentStates.UNKNOWN })
      }

      if (httpResponse.statusCode === 200 && body['hub.challenge'] === challenge) {
        cb(null, { state: this.intentStates.ACCEPTED })
      } else if (httpResponse.statusCode === 404) {
        cb(null, { state: this.intentStates.DECLINED })
      } else {
        cb(null, { state: this.intentStates.UNKNOWN })
      }
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
  _discover (url) {
    const opt = {
      url: url
    }

    Request.get(opt, (err, httpResponse, body) => {
      if (err) {
        return this.error('error', err)
      }
    })
  }

  /**
   * Link Headers [RFC5988]: the publisher should include at least one Link Header [RFC5988] with rel=hub (a hub link header) as well as exactly one Link Header [RFC5988] with rel=self (the self link header)
   *
   * Example: https://documentation.superfeedr.com/publishers.html
   *
   * @memberof Server
   */
  _checkInLinkHeaders () {}
  /**
   * If the topic is an XML based feed, publishers should use embedded link elements as described in Appendix B of Web Linking [RFC5988].
   * Similarly, for HTML pages, publishers should use embedded link elements as described in Appendix A of Web Linking [RFC5988].
   * However, for HTML, these <link> elements must be only present in the <head> section of the HTML document. (Note: The restriction on limiting <link> to the <head> is At Risk.)
   *
   * Example: https://documentation.superfeedr.com/publishers.html
   *
   * @memberof Server
   */
  _checkInRSSFeed () {}
  /**
   * If the topic is an XML based feed, publishers should use embedded link elements as described in Appendix B of Web Linking [RFC5988].
   * Similarly, for HTML pages, publishers should use embedded link elements as described in Appendix A of Web Linking [RFC5988].
   * However, for HTML, these <link> elements must be only present in the <head> section of the HTML document. (Note: The restriction on limiting <link> to the <head> is At Risk.)
   *
   * Example: https://documentation.superfeedr.com/publishers.html
   *
   * @memberof Server
   */
  _checkInATOMFeed () {}
  /**
   *
   *
   * @param {any} req
   * @param {any} res
   *
   * @memberof Server
   */
  _handlePublishingRequest (req, res) {}
  /**
   *
   *
   * @param {any} req
   * @param {any} res
   *
   * @memberof Server
   */
  _handleSubscriptionRequest (req, reply) {
    const callbackUrl = req.body['hub.callback']
    const mode = req.body['hub.mode']
    const topic = req.body['hub.topic']
    const leaseSeconds = req.body['hub.lease_seconds']
    const secret = req.body['hub.secret']

    const { db } = this.server.mongo
    this.subscriptionCollection = db.collection('subscriptions')

    if (mode === this.modes.SUBSCRIBE) {
      Async.waterfall([
        (callback) => {
          this._verifyIntent(callbackUrl, mode, topic, this.hyperid(), callback)
        },
        (validation, callback) => {
          if (validation.state === 'accepted') {
            this._isDuplicateSubscription(topic, callback)
          } else if (validation.state === 'declined') {
            callback(Boom.forbidden('Subscriber has declined'))
          } else if (validation.state === 'unknown') {
            callback(Boom.forbidden('Subscriber has return an invalid answer'))
          }
        },
        (duplicate, callback) => {
          if (duplicate) {
            callback(Boom.badRequest('Subscriber was already registered'))
          }
        },
        (callback) => {
          this._createSubscription({
            callbackUrl,
            mode,
            topic,
            leaseSeconds,
            secret: secret
          }, callback)
        }
      ], (err, result) => {
        if (err) {
          return reply.code(err.output.statusCode).send(err)
        }

        reply.code(200).send()
      })
    } else {
      this._unsubscribe(topic, callbackUrl, (err, result) => {
        if (err) {
          this.emit('error', err)
          reply.code(400).send()
        } else {
          reply.code(200).send()
        }
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
  _unsubscribe (topic, callbackUrl, cb) {
    this.subscriptionCollection.findOneAndDelete({
      topic: topic,
      callbackUrl: callbackUrl
    }, (err, result) => {
      if (err) {
        return cb(Boom.badImplementation('Subscription could not be deleted'))
      }
      cb(null, result.value)
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
  _isDuplicateSubscription (topic, callbackUrl, cb) {
    this.subscriptionCollection.findOne({
      topic: topic,
      callbackUrl: callbackUrl
    }, (err, result) => {
      if (err) {
        return cb(Boom.notFound('Susbcription could not be found'))
      }
      cb(null, result !== null)
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
  _createSubscription (subscription, cb) {
    this.subscriptionCollection.create({
      callbackUrl: subscription.callbackUrl,
      mode: subscription.mode,
      topic: subscription.topic,
      lease_seconds: subscription.leaseSeconds,
      secret: subscription.secret
    }, (err, result) => {
      if (err) {
        return cb(Boom.badImplementation('Subscription could not be created'))
      }
      cb(null, result)
    })
  }

  /**
   *
   *
   *
   * @memberof Server
   */
  _registerHandlers () {
    this.server.post('/subscribe', Schemas.subscriptionRequest, (req, resp) => this._handleSubscriptionRequest(req, resp))
    this.server.post('/publisher/discover', Schemas.publishingRequest, (req, resp) => this._handlePublishingRequest(req, resp))
  }

  /**
   *
   *
   *
   * @memberof Server
   */
  listen () {
    this.server.listen.apply(this.server, arguments)
  }

  /**
   *
   *
   *
   * @memberof Server
   */
  close (cb) {
    this.server.close(cb)
  }
}

module.exports = Server
