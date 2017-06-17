'use strict'

const Code = require('code')
const expect = Code.expect
const Hub = require('./../packages/websub-hub')
const MongoInMemory = require('mongo-in-memory')
const MockAdapter = require('axios-mock-adapter')
const Websocket = require('ws')
const Axios = require('axios')
const Jwt = require('jsonwebtoken')

describe('Websocket', function () {
  const PORT = 3000
  let hub
  let mongoInMemory
  let topic = 'http://testblog.de'
  let jwtSecret = '123456'
  let jwtToken = Jwt.sign({ client: 'peter' }, jwtSecret)

  // Start up our own nats-server
  before(function (done) {
    mongoInMemory = new MongoInMemory()
    mongoInMemory.start(() => {
      hub = new Hub({
        timeout: 500,
        logLevel: 'debug',
        jwt: {
          secret: '123456'
        },
        retry: {
          retries: 1,
          randomize: false
        },
        mongo: {
          url: mongoInMemory.getMongouri('hub')
        }
      })
      hub.listen().then(() => {
        mongoInMemory.start(() => {
          done()
        })
      })
    })
  })

  // Shutdown our server after we are done
  after(function (done) {
    hub.close().then(() => {
      mongoInMemory.stop(() => {
        done()
      })
    })
  })

  it('Should be able to subscribe', function (done) {
    const callbackUrl = 'http://127.0.0.1:3002'

    const client = new Websocket('ws://localhost:' + PORT + '?token=' + jwtToken)

    const mock = new MockAdapter(hub.httpClient)

    mock.onPost(callbackUrl).reply(function (config) {
      return [200, config.data]
    })

    client.on('open', function open () {
      client.send(JSON.stringify({
        'hub.callback': callbackUrl,
        'hub.mode': 'subscribe',
        'hub.topic': topic + '/feeds',
        'hub.protocol': 'ws'
      }))
    })

    client.on('message', function incoming (data) {
      const response = JSON.parse(data)
      if (response['hub.mode'] === 'subscribe') {
        expect(response.success).to.be.equals(true)
        client.close()
        done()
      }
    })
  })

  it('Should not be able to verify subscription intent because invalid status code', function (done) {
    const callbackUrl = 'http://127.0.0.1:3002'

    const client = new Websocket('ws://localhost:' + PORT + '?token=' + jwtToken)

    const mock = new MockAdapter(hub.httpClient)

    mock.onPost(callbackUrl).reply(function (config) {
      return [401, config.data]
    })

    client.on('open', function open () {
      client.send(JSON.stringify({
        'hub.callback': callbackUrl,
        'hub.mode': 'subscribe',
        'hub.topic': topic + '/feeds',
        'hub.protocol': 'ws'
      }))
    })

    client.on('message', function incoming (data) {
      const response = JSON.parse(data)
      if (response['hub.mode'] === 'subscribe') {
        expect(response.success).to.be.equals(false)
        client.close()
        done()
      }
    })
  })

  it('Should not be able to verify subscription intent because invalid challenge', function (done) {
    const callbackUrl = 'http://127.0.0.1:3002'

    const client = new Websocket('ws://localhost:' + PORT + '?token=' + jwtToken)

    const mock = new MockAdapter(hub.httpClient)

    mock.onPost(callbackUrl).reply(200, {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds',
      'hub.protocol': 'ws',
      'hub.challenge': 'wrong'
    })

    client.on('open', function open () {
      client.send(JSON.stringify({
        'hub.callback': callbackUrl,
        'hub.mode': 'subscribe',
        'hub.topic': topic + '/feeds',
        'hub.protocol': 'ws'
      }))
    })

    client.on('message', function incoming (data) {
      const response = JSON.parse(data)
      if (response['hub.mode'] === 'subscribe') {
        expect(response.success).to.be.equals(false)
        client.close()
        done()
      }
    })
  })

  it('Should be able to receive updates', function (done) {
    const callbackUrl = 'http://127.0.0.1:3002'

    const mock = new MockAdapter(hub.httpClient)

    mock.onPost(callbackUrl).reply(function (config) {
      return [200, config.data]
    })

    const feed = {
      'version': 'https://jsonfeed.org/version/1',
      'title': 'My Example Feed',
      'home_page_url': 'https://example.org/',
      'feed_url': 'https://example.org/feed.json',
      'items': [{
        'id': '2',
        'content_text': 'This is a second item.',
        'url': 'https://example.org/second-item'
      },
      {
        'id': '1',
        'content_html': '<p>Hello, world!</p>',
        'url': 'https://example.org/initial-post'
      }
      ]
    }

    mock.onGet(topic + '/feeds').reply(200, feed)

    const client = new Websocket('ws://localhost:' + PORT + '?token=' + jwtToken)

    client.on('open', function open () {
      client.send(JSON.stringify({
        'hub.callback': callbackUrl,
        'hub.mode': 'subscribe',
        'hub.topic': topic + '/feeds',
        'hub.protocol': 'ws'
      }))
    })

    client.on('message', function incoming (data) {
      const response = JSON.parse(data)
      if (response['hub.mode'] === 'subscribe') {
        Axios.default.post(`http://localhost:${PORT}/publish`, {
          'hub.mode': 'publish',
          'hub.url': topic + '/feeds'
        })
      } else if (response['hub.mode'] === 'update') {
        expect(response.success).to.be.equals(true)
        expect(response.result).to.be.equals(feed)
        client.close()
        done()
      }
    })
  })

  it('Should not be able to connect with wrong signed key', function (done) {
    const client = new Websocket('ws://localhost:' + PORT + '?token=wed23d23d')

    client.on('open', function open () {
    })

    client.on('error', function error () {
      client.close()
      done()
    })
  })

  it('Should be able to unsubscribe', function (done) {
    const callbackUrl = 'http://127.0.0.1:3002'

    const client = new Websocket('ws://localhost:' + PORT + '?token=' + jwtToken)

    const mock = new MockAdapter(hub.httpClient)

    mock.onPost(callbackUrl).reply(function (config) {
      return [200, config.data]
    })

    client.on('open', function open () {
      client.send(JSON.stringify({
        'hub.callback': callbackUrl,
        'hub.mode': 'subscribe',
        'hub.topic': topic + '/feeds',
        'hub.protocol': 'ws'
      }))
    })

    client.on('message', function incoming (data) {
      const response = JSON.parse(data)
      if (response['hub.mode'] === 'subscribe') {
        expect(response.success).to.be.equals(true)
        client.send(JSON.stringify({
          'hub.callback': callbackUrl,
          'hub.mode': 'unsubscribe',
          'hub.topic': topic + '/feeds'
        }))
      } else if (response['hub.mode'] === 'unsubscribe') {
        expect(response.success).to.be.equals(true)
        client.close()
        done()
      }
    })
  })

  it('Should be able to get list of all subscription', function (done) {
    const client = new Websocket('ws://localhost:' + PORT + '?token=' + jwtToken)

    client.on('open', function open () {
      client.send(JSON.stringify({
        'hub.mode': 'list'
      }))
    })

    client.on('message', function incoming (data) {
      const response = JSON.parse(data)
      if (response['hub.mode'] === 'list') {
        expect(response.success).to.be.equals(true)
        client.close()
        done()
      }
    })
  })
})
