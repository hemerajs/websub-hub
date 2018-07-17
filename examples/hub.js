'use strict'

const WebSubHub = require('../packages/websub-hub').server

const hub = new WebSubHub({
  port: 3000,
  logLevel: 'info',
  mongo: {
    url: 'mongodb://localhost:27017/hub'
  }
})

hub
  .listen()
  .then(() => {
    console.log(
      'Hub listening on: ' +
        'http://localhost:' +
        hub.server.server.address().port
    )
  })
  .catch(console.error)
