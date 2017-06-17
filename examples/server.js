'use strict'

const WebSubHub = require('../packages/websub-hub').server

const hub = new WebSubHub({
  port: 3000,
  logLevel: 'info',
  jwt: {
    secret: '123456'
  },
  mongo: {
    url: 'mongodb://localhost:27017/hub'
  }
})

hub.listen().then(() => {
  console.log('server listening on: ' + 'http://localhost:' + hub.server.server.address().port)
})
.catch(console.error)
