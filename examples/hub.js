'use strict'

const Hub = require('../packages/websub-hub')

module.exports = async function() {
  const hub = Hub({
    port: 3000,
    logLevel: 'info',
    mongo: {
      url: 'mongodb://localhost:27017/hub'
    }
  })

  await hub.listen()

  hub.log.info(
    'Hub listening on: ' +
      'http://localhost:' +
      hub.server.server.address().port
  )
}

if (require.main === module) {
  module.exports().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
