'use strict'

const Hub = require('../packages/websub-hub')

const hub = Hub({
  port: 3000,
  logLevel: 'info',
  mongo: {
    url: 'mongodb://localhost:27017/hub'
  }
})

hub
  .listen()
  .then(() => {
    hub.log.info(
      'Hub listening on: ' +
        'http://localhost:' +
        hub.server.server.address().port
    )
  })
  .catch(console.error)
