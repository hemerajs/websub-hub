'use strict'

const WebSubHub = require('../websub-hub')

const hub = new WebSubHub()

hub.listen(3000, function (err) {
  if (err) throw err
  console.log('server listening on: ' + 'http://localhost:' + hub.server.server.address().port)
})
