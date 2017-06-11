#! /usr/bin/env node

'use strict'

const Hub = require('./../')
const hub = new Hub()
hub.listen(3000, function (err) {
  if (err) throw err
  console.log('server listening on: ' + 'http://localhost:' + hub.server.server.address().port)
})
