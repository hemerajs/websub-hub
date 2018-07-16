const fastify = require('fastify')()

fastify.get('/', function(req, res) {
  console.log(req.query)
  res.send(req.query)
})

fastify.listen(5000, err => {
  if (err) throw err
  console.log(`server listening on ${fastify.server.address().port}`)
})
