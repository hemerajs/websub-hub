'use strict'

const Fp = require('fastify-plugin')
const WebSocket = require('ws')

module.exports = Fp(
  function(fastify, opts, next) {
    const wss = new WebSocket.Server({
      server: fastify.server,
      maxPayload: opts.maxPayload,
      handshakeTimeout: opts.handshakeTimeout,
      perMessageDeflate: opts.perMessageDeflate
    })

    function noop() {}

    function heartbeat() {
      this.isAlive = true
    }

    const buildClientKey = (topic, callbackUrl) =>
      `topic:${topic};callback:${callbackUrl}`

    wss.on('connection', function connection(ws, req) {
      fastify.log.info('new ws connection')
      ws.isAlive = true
      ws.on('pong', heartbeat)

      opts.handle(ws, req)
    })

    setInterval(function ping() {
      fastify.log.info('ws ping send')
      wss.clients.forEach(function each(ws) {
        if (ws.isAlive === false) {
          return ws.terminate()
        }

        ws.isAlive = false
        ws.ping(noop)
      })
    }, 30000).unref()

    fastify.decorate('websocketServer', wss)
    fastify.decorate('websocketClientKey', buildClientKey)

    next()
  },
  {
    name: 'websocket'
  }
)
