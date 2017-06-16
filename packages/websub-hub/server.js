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
const PromiseRetry = require('promise-retry')
const Url = require('url')
const Rx = require('rxjs')
const Websocket = require('ws')

const defaultOptions = {
  name: 'hub',
  port: 3000,
  address: '127.0.0.1',
  timeout: 2000,
  logLevel: 'fatal',
  hubUrl: 'http://127.0.0.1:3000',
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
function Server (options) {
  EventEmitter.call(this)

  this.options = Hoek.applyToDefaults(defaultOptions, options || {})
  this.server = Fastify(this.options)
  this.httpClient = Axios.create({
    timeout: this.options.timeout
  })
  this.hyperid = Hyperid()
  this._addContentTypeParser()
  this._createDbConnection()
  this._createWsConnection()
  this.wsClients = new Map()
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
  this.outgoingObservable = new Rx.Subject()

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
  // register mongodb
  this.server.register(require('fastify-mongodb'), this.options.mongo, err => {
    if (err) {
      this.log.error(err, 'Could not connect to Mongodb')
    }
  })
}

Server.prototype._createWsConnection = function () {
  const self = this

  function verifyWsClient (info) {
    return true
  }

  this.wss = new Websocket.Server({
    perMessageDeflate: false,
    server: this.server.server,
    verifyClient: verifyWsClient
  })

  this.wss.on('connection', (ws, req) => {
    this.log.info('New Websocket client')

    var source = Rx.Observable.fromEvent(ws, 'message', (e) => JSON.parse(e.data))

    source.filter(x => x['hub.mode'] === 'ping').subscribe(
      function (x) {
        self.log.info('Ping request')
        ws.send('pong')
      },
      function (err) {
        self.log.error(err, 'Receiving websocket message')
      })

    source.filter(x => x['hub.mode'] === 'subscribe').subscribe(
      function (x) {
        self.log.info('Subscription request')
        ws.send('pong')
      },
      function (err) {
        self.log.error(err, 'Receiving websocket message')
      })
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
      }
      return this.intentStates.UNKNOWN
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
Server.prototype._distributeContentHttp = function (sub, content) {
  const headers = {}
  // The request must include at least one Link Header
  headers['Link'] = `<${sub.topic}>; rel="self", <${this.options.hubUrl}>; rel="hub"`
  headers['Content-Type'] = 'application/json'
  // must send a X-Hub-Signature header if the subscription was made with a hub.secret
  if (sub.secret) {
    headers['X-Hub-Signature'] = Crypto.createHmac('sha256', sub.secret).update(JSON.stringify(content)).digest('hex')
  }

  return PromiseRetry((retry, number) => {
    this.log.debug('Attempt number %s for Sub: %s', number, sub._id)

    return this.httpClient({
      method: 'post',
      headers,
      url: sub.callbackUrl,
      data: content
    })
      .catch(retry)
  }, this.options.retry)
    .then((response) => this.log.debug('Sub: %s respond with %s', sub._id, response.status))
    .catch((error) => {
      const err = Boom.wrap(error, error.response.status)
      this.log.debug({
        httpError: err
      }, 'Subscription: %s was canceled', sub._id)

      // remove subscription and ignore http errors to don't break the batch request
      this._cancelSubscription(sub)
    })
}

/**
 *
 *
 * @param {any} sub
 * @param {any} content
 */
Server.prototype._distributeContentWs = function (sub, content) {
  const response = {}
  response.headers = {}
  response.data = content
  // The request must include at least one Link Header
  response.headers['Link'] = `<${sub.topic}>; rel="self", <${this.options.hubUrl}>; rel="hub"`
  response.headers['Content-Type'] = 'application/json'
  // must send a X-Hub-Signature header if the subscription was made with a hub.secret
  if (sub.secret) {
    response.headers['X-Hub-Signature'] = Crypto.createHmac('sha256', sub.secret).update(JSON.stringify(content)).digest('hex')
  }
  const key = sub.callbackUrl + ':' + sub.topic
  const client = this.wsClients.get(key)

  if (client) {
    try {
      client.send(JSON.stringify(response))
    } catch (err) {
      this.log.error(err)
    }
  } else {
    this.log.info('Ws Client could not be found!')
  }

  return Promise.resolve()
}

/**
 *
 *
 * @param {any} subscription
 * @returns
 */
Server.prototype._cancelSubscription = function (subscription) {
  return this.subscriptionsCollection.findOneAndDelete({
    callbackUrl: subscription.callbackUrl,
    topic: subscription.topic
  }).catch((error) => {
    this.log.error({
      internalError: error
    }, 'Subscription could not be deleted')
  })
}

/**
 *
 *
 * @param {any} req
 * @param {any} reply
 */
Server.prototype._handlePublishRequest = function (req, reply) {
  const topicUrl = req.body['hub.url']

  const {db} = this.server.mongo
  this.subscriptionsCollection = db.collection('subscriptions')

  this._fetchTopicContent(topicUrl)
    .then((content) => {
      return this.subscriptionsCollection.find({
        topic: topicUrl
      }).toArray().then((subscriptions) => {
        const requests = []
        subscriptions.forEach((s) => {
          if (s.protocol === 'ws') {
            requests.push(this._distributeContentWs(s, content))
          } else {
            requests.push(this._distributeContentHttp(s, content))
          }
        })
        return Promise.all(requests)
      })
    })
    .then((content) => {
      reply.code(200).send()
    })
    .catch((err) => {
      this.log.error(err)
      reply.code(err.output.statusCode).send(err)
    })
}

/**
 *
 *
 * @param {any} topic
 * @returns
 */
Server.prototype._fetchTopicContent = function (topic) {
  return this.httpClient.get(topic).then((response) => {
    return response.data
  })
    .catch((error) => {
      return Promise.reject(Boom.wrap(error, error.response.status))
    })
}

/**
 *
 *
 * @param {any} req
 * @param {any} reply
 */
Server.prototype._handleSubscriptionRequest = function (req, reply) {
  const callbackUrl = req.body['hub.callback']
  const mode = req.body['hub.mode']
  const topic = req.body['hub.topic']
  const leaseSeconds = req.body['hub.lease_seconds']
  const secret = req.body['hub.secret']
  const protocol = req.body['hub.protocol']
  const challenge = this.hyperid()

  const {db} = this.server.mongo
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
          secret,
          protocol})
      } else {
        return this._unsubscribe(topic, callbackUrl)
      }
    })
    .then(x => reply.code(200).send())
    .catch(err => {
      this.log.error(err)
      reply.code(err.output.statusCode).send(err)
    })
}

/**
 *
 *
 * @param {any} req
 * @param {any} reply
 */
Server.prototype._handleSubscriptionListRequest = function (req, reply) {
  const {db} = this.server.mongo
  const subscriptionCollection = db.collection('subscriptions')
  const cursor = subscriptionCollection.find({})
  cursor.project({
    secret: 0
  })

  reply.code(200).send(cursor.toArray())
}

/**
 *
 *
 * @param {any} topic
 * @param {any} callbackUrl
 * @param {any} cb
 * @returns
 */
Server.prototype._unsubscribe = function (topic, callbackUrl, cb) {
  return this.subscriptionCollection.findOneAndDelete({
    topic: topic,
    callbackUrl: callbackUrl
  })
    .catch((err) => {
      return Promise.reject(Boom.wrap(err, 500, 'Subscription could not be deleted'))
    })
}

/**
 *
 *
 * @param {any} topic
 * @param {any} callbackUrl
 * @returns
 */
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

/**
 *
 *
 * @param {any} subscription
 * @param {any} cb
 * @returns
 */
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
        protocol: subscription.protocol,
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
  this.server.get('/subscriptions', (req, resp) => this._handleSubscriptionListRequest(req, resp))
}

Server.prototype.listen = function () {
  return Promisify(this.server.listen, {
    thisArg: this.server
  })(this.options.port, this.options.address)
}

Server.prototype.close = function () {
  return Promisify(this.server.close, {
    thisArg: this.server
  })()
}

module.exports = Server
