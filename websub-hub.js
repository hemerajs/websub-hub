'use strict'

const Schemas = require('./lib/schemas')
const Fastify = require('fastify')
const FormBody = require('body/form')

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
    this._addContentTypeParser()
    this._registerHandlers()
  }
  _addContentTypeParser () {
    this.server.addContentTypeParser('application/x-www-form-urlencoded', function (req, done) {
      FormBody(req, (err, body) => {
        done(err || body)
      })
    })
  }
  _handleSubscriptionRequest (err, req, res) {}
  _registerHandlers () {
    this.server.post('/sub', Schemas.subscriptionRequest, this._handleSubscriptionRequest)
  }
  listen () {
    this.server.listen.apply(this.server, arguments)
  }
}

module.exports = Server
