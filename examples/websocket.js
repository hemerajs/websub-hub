const Websocket = require('ws')
const Jwt = require('jsonwebtoken')

const jwtSecret = '123456'
const PORT = 3000
const jwtToken = Jwt.sign({ client: 'peter' }, jwtSecret)
const client = new Websocket('ws://localhost:' + PORT + '?token=' + jwtToken)

client.on('open', function open () {
  client.send(JSON.stringify({
    'hub.callback': 'http://127.0.0.1:5000',
    'hub.mode': 'subscribe',
    'hub.topic': 'http://127.0.0.1:6000'
  }))
})

client.on('message', function incoming (data) {
  const response = JSON.parse(data)
  console.log(response)
})
