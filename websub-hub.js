'use strict'

const Schemas = require('./lib/schemas')
const Fastify = require('fastify')

const defaultOptions = {
  fastify: {
    logger: {
      level: 'info'
    }
  }
}

class Server {
  /**
   * Creates an instance of Server.
   *
   * @memberof Server
   */
  constructor (options) {
    this.options = options || {}
    this.server = Fastify(Object.assign(this.options, defaultOptions))
    this._registerHandlers()
  }
  _handleSubscriptionRequest (err, req, res) {}
  _registerHandlers () {
    this.server.post('/sub', Schemas.subscriptionRequest, this._handleSubscription)
  }
  listen () {
    this.server.listen.apply(this.server, arguments)
  }
}

module.exports = Server
