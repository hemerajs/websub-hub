const fastify = require('fastify')

module.exports = async function() {
  const server = fastify({
    logger: {
      level: 'info'
    }
  })
  server.get('/', function(req, res) {
    console.log('subscription verified', req.query)
    res.send(req.query)
  })

  server.post('/', function(req, res) {
    console.log('received blog content', req.body)
    res.send()
  })

  await server.listen(5000)
}

if (require.main === module) {
  module.exports().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
