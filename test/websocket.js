'use strict'

const Code = require('code')
const expect = Code.expect
const Hub = require('./../packages/websub-hub')
const MongoInMemory = require('mongo-in-memory')
const MockAdapter = require('axios-mock-adapter')
const Sinon = require('sinon')
const Websocket = require('ws')

describe('Websocket', function () {
  const PORT = 3000
  let hub
  let mongoInMemory
  let topic = 'http://testblog.de'

  // Start up our own nats-server
  before(function (done) {
    mongoInMemory = new MongoInMemory()
    mongoInMemory.start(() => {
      hub = new Hub({
        timeout: 500,
        logLevel: 'debug',
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

  it('Should be able to establish a websocket connection', function (done) {
    const callbackUrl = 'http://127.0.0.1:3001'

    const client = new Websocket('ws://localhost:' + PORT)
    client.on('open', function open () {
      client.send('{ "hub.mode": "ping" }')
    })

    client.on('message', function incoming (data) {
      expect(data).to.be.equals('pong')
      client.close()
      done()
    })
  })

  it('Should be able to subscribe via websocket connection', function (done) {
    const callbackUrl = 'http://127.0.0.1:3002'

    const mock = new MockAdapter(hub.httpClient)

    const callbackUrlCall = Sinon.spy()
    const distributeContentCall = Sinon.spy()

    mock.onPost(callbackUrl).replyOnce(function (config) {
      callbackUrlCall()
      return [200, config.data]
    })

    mock.onPost(callbackUrl).replyOnce(function (config) {
      expect(config.headers['Content-Type']).to.be.equals('application/json')
      expect(config.headers.Link).to.equals('<http://testblog.de/feeds>; rel="self", <http://127.0.0.1:3002>; rel="hub"')
      distributeContentCall()
      return [200]
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

    const client = new Websocket('ws://localhost:' + PORT)

    client.on('open', function open () {
      client.send(JSON.stringify({
        'hub.callback': callbackUrl,
        'hub.mode': 'subscribe',
        'hub.topic': topic + '/feeds',
        'hub.protocol': 'ws'
      }))
    })

    client.on('message', function incoming (data) {
      client.close()
      done()
    })
  })
})
