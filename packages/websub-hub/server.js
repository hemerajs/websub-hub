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
const Jwt = require('jsonwebtoken')
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
  ws: {
    pingInterval: 30000
  },
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
    const {
      db
    } = this.server.mongo
    this.subscriptionCollection = db.collection('subscriptions')
    this._createWsConnection()
  })
}

Server.prototype._startWsPingTimer = function () {
  const self = this
  this.wsPingTimer = setInterval(() => {
    this.wss.clients.forEach(function each (ws) {
      if (ws.isAlive === false) {
        self._cleanWsSubscriptionsByClient(ws.webhubToken.client).then(x => ws.terminate())
        return
      }

      ws.isAlive = false
      ws.ping('', false, true)
    })
  }, this.options.ws.pingInterval)
}

Server.prototype._createWsConnection = function () {
  const self = this

  function verifyWsClient (info, done) {
    const location = Url.parse(info.req.url, true)
    Jwt.verify(location.query.token, self.options.jwt.secret, self.options.jwt.options, (err, decoded) => {
      if (err) {
        done(false)
      } else {
        info.req.webhubToken = decoded
        done(true)
      }
    })
  }

  function heartbeat () {
    this.isAlive = true
  }

  this.wss = new Websocket.Server({
    perMessageDeflate: false,
    server: this.server.server,
    verifyClient: verifyWsClient,
    clientTracking: true
  })

  this.wss.on('connection', (ws, req) => {
    this.log.info('New Websocket client')

    ws.isAlive = true
    ws.on('pong', heartbeat)
    this._startWsPingTimer()

    ws.webhubToken = req.webhubToken

    function send (payload) {
      if (ws.readyState === Websocket.OPEN) {
        ws.send(JSON.stringify(payload))
      }
    }

    var source = Rx.Observable.fromEvent(ws, 'message', (e) => JSON.parse(e.data))

    source.filter(x => x['hub.mode'] === 'subscribe').subscribe(
      (payload) => {
        self.log.info('Subscription request')
        const callbackUrl = payload['hub.callback']
        const mode = payload['hub.mode']
        const topic = payload['hub.topic']
        const leaseSeconds = payload['hub.lease_seconds']
        const secret = payload['hub.secret']
        const format = payload['hub.format'] || 'json'
        const challenge = this.hyperid()
        const protocol = 'ws'

        this._verifyIntent(callbackUrl, mode, topic, challenge).then((intent) => {
          if (intent === this.intentStates.DECLINED) {
            return Promise.reject(Boom.forbidden('Subscriber has declined'))
          } else if (intent === this.intentStates.UNKNOWN) {
            return Promise.reject(Boom.forbidden('Subscriber has return an invalid answer'))
          }
        })
        .then(() => {
          this.log.info('Intent: %s for callback %s verified', mode, callbackUrl)
          this._createSubscription({
            callbackUrl,
            mode,
            topic,
            leaseSeconds,
            secret,
            protocol,
            format,
            token: req.webhubToken
          })
          send({ success: true, 'hub.mode': mode })
        })
        .catch((err) => {
          this.log.error('Error: %s, Mode: %s, Callback: %s', err.message, mode, callbackUrl)
          send({ success: false, 'hub.mode': mode })
        })
      },
      (err) => {
        self.log.error(err, 'Subscription request')
        send({ success: false, error: err })
      })

    source.filter(x => x['hub.mode'] === 'unsubscribe').subscribe(
      (payload) => {
        self.log.info('Unsubscription request')
        const mode = payload['hub.mode']
        const callbackUrl = payload['hub.callback']
        const topic = payload['hub.topic']
        const protocol = 'ws'
        const challenge = this.hyperid()

        const sub = {
          topic,
          callbackUrl,
          protocol
        }

        this._verifyIntent(callbackUrl, mode, topic, challenge).then((intent) => {
          if (intent === this.intentStates.DECLINED) {
            return Promise.reject(Boom.forbidden('Subscriber has declined'))
          } else if (intent === this.intentStates.UNKNOWN) {
            return Promise.reject(Boom.forbidden('Subscriber has return an invalid answer'))
          }
        })
        .then(() => {
          this.log.info('Intent: %s for callback %s verified', mode, callbackUrl)
          this._unsubscribe(sub)

          send({ success: true, 'hub.mode': mode })
        })
        .catch((err) => {
          this.log.error('Error: %s, Mode: %s, Callback: %s', err.message, mode, callbackUrl)
          send({ success: false, 'hub.mode': mode })
        })
      },
      (err) => {
        self.log.error(err, 'Unsubscription request')
        send({ success: false, error: err })
      })

    source.filter(x => x['hub.mode'] === 'list').subscribe(
      (payload) => {
        self.log.info('Subscription list request')
        const mode = payload['hub.mode']
        this._getAllActiveSubscription().then((list) => {
          send({
            success: true,
            'hub.mode': mode,
            result: list
          })
        })
      },
      (err) => {
        self.log.error(err, 'Unsubscription request')
        send({ success: false, error: err })
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
Server.prototype._distributeContentHttp = function (sub, content) {
  const headers = {}
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
  const response = {
    success: true,
    'hub.mode': 'update'
  }
  response.headers = {
    topic: sub.topic,
    hub: this.options.hubUrl
  }
  response.result = content

  // must send a X-Hub-Signature header if the subscription was made with a hub.secret
  if (sub.secret) {
    response.headers['X-Hub-Signature'] = Crypto.createHmac('sha256', sub.secret).update(JSON.stringify(content)).digest('hex')
  }

  this.log.info('%d Websocket clients', this.wss.clients.size)

  for (let client of this.wss.clients.values()) {
    if (client.webhubToken.user === sub.token.user) {
      this.log.info('Websocket client matched %s', sub.token.client)
      try {
        if (client.readyState === Websocket.OPEN) {
          this.log.info('Distribute content to websocket client')
          client.send(JSON.stringify(response))
          return Promise.resolve()
        }
      } catch (err) {
        this.log.error(err)
        return Promise.resolve()
      }
    } else {
      this.log.warn('No Websocket client match %s <-> %s', client.webhubToken.client, sub.token.client)
    }
  }
}

/**
 *
 *
 * @param {any} subscription
 * @returns
 */
Server.prototype._cancelSubscription = function (subscription) {
  return this.subscriptionCollection.findOneAndDelete({
    callbackUrl: subscription.callbackUrl,
    topic: subscription.topic,
    protocol: subscription.protocol
  }).catch((error) => {
    this.log.error({
      internalError: error
    }, 'Subscription could not be deleted')
  })
}

/**
 *
 *
 * @param {any} connectionId
 * @returns
 */
Server.prototype._cleanWsSubscriptionsByClient = function (client) {
  return this.subscriptionCollection.deleteMany({
    'token.client': client
  }).catch((error) => {
    this.log.error({
      internalError: error
    }, 'Subscriptions could not be deleted')
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

  const {
    db
  } = this.server.mongo
  this.subscriptionsCollection = db.collection('subscriptions')

  return this.subscriptionsCollection.find({
    topic: topicUrl
  }).toArray().then((subscriptions) => {
    const requests = []
    subscriptions.forEach((sub) => {
      if (sub.protocol === 'ws') {
        requests.push(this._fetchTopicContent(sub).then((content) => {
          return this._distributeContentWs(sub, content)
        }))
      } else {
        requests.push(this._fetchTopicContent(sub).then((content) => {
          return this._distributeContentHttp(sub, content)
        }))
      }
    })
    return Promise.all(requests)
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
Server.prototype._fetchTopicContent = function (sub) {
  const headers = {}

  if (sub.format === 'json') {
    headers.Accept = 'application/json'
  }

  return this.httpClient.get(sub.topic, {
    headers
  }).then((response) => {
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
  const format = req.body['hub.format'] || 'json'
  const protocol = 'http'
  const challenge = this.hyperid()

  const sub = {
    callbackUrl,
    topic,
    leaseSeconds,
    secret,
    protocol,
    format
  }

  this._verifyIntent(sub.callbackUrl, mode, sub.topic, challenge).then((intent) => {
    if (intent === this.intentStates.DECLINED) {
      return Promise.reject(Boom.forbidden('Subscriber has declined'))
    } else if (intent === this.intentStates.UNKNOWN) {
      return Promise.reject(Boom.forbidden('Subscriber has return an invalid answer'))
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

Server.prototype._getAllActiveSubscription = function (req, reply) {
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
Server.prototype._handleSubscriptionListRequest = function (req, reply) {
  reply.code(200).send(this._getAllActiveSubscription())
}

/**
 *
 *
 * @param {any} topic
 * @param {any} callbackUrl
 * @returns
 */
Server.prototype._unsubscribe = function (sub) {
  return this.subscriptionCollection.findOneAndDelete({
    topic: sub.topic,
    callbackUrl: sub.callbackUrl,
    protocol: sub.protocol
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
Server.prototype._isDuplicateSubscription = function (sub) {
  return this.subscriptionCollection.findOne({
    topic: sub.topic,
    callbackUrl: sub.callbackUrl,
    protocol: sub.protocol
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
  return this._isDuplicateSubscription(subscription).then((isDuplicate) => {
    if (isDuplicate === false) {
      // create new subscription
      return this.subscriptionCollection.insertOne({
        callbackUrl: subscription.callbackUrl,
        mode: subscription.mode,
        topic: subscription.topic,
        leaseSeconds: subscription.leaseSeconds,
        secret: subscription.secret,
        protocol: subscription.protocol,
        token: subscription.token,
        format: subscription.format,
        createdAt: new Date()
      }).catch((err) => {
        return Promise.reject(Boom.wrap(err, 500, 'Subscription could not be created'))
      })
    } else {
      // renew leaseSeconds subscription time
      return this.subscriptionCollection.findOneAndUpdate({
        callbackUrl: subscription.callbackUrl,
        topic: subscription.topic,
        protocol: subscription.protocol
      }, {
        $set: {
          leaseSeconds: subscription.leaseSeconds,
          updatedAt: new Date(),
          token: subscription.token
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
