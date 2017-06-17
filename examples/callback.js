const Express = require('express')
const Bodyparser = require('body-parser')
const app = Express()

app.use(Bodyparser.json())

app.post('/', function (req, res) {
  console.log(req.body)
  res.send(req.body)
})

app.listen(5000, () => console.log('Server listen on 127.0.0.1:5000'))
