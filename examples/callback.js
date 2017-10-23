const fastify = require('fastify')()

fastify.post('/', function(req, res) {
  console.log(req.body)
  res.send(req.body)
})

fastify.listen(5000, err => {
  if (err) throw err
  console.log(`server listening on ${fastify.server.address().port}`)
})
