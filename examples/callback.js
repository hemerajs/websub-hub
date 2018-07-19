const fastify = require('fastify')({
  logger: {
    level: 'info'
  }
})

fastify.get('/', function(req, res) {
  console.log('subscription verified', req.body)
  res.send(req.query)
})

fastify.post('/', function(req, res) {
  console.log('received blog content', req.body)
  res.send()
})

fastify.listen(5000, err => {
  if (err) throw err
})
