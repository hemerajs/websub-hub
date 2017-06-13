'use strict'

const Code = require('code')
const expect = Code.expect
const Axios = require('axios')
const Hub = require('./../packages/websub-hub')
const MongoInMemory = require('mongo-in-memory')
const MockAdapter = require('axios-mock-adapter')
const Sinon = require('sinon')
const WebsocketStream = require('websocket-stream')

describe('Websocket Subscription', function () {
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

  it('Should be bale to receive subscription updates on websocket connections', function (done) {
    const callbackUrl = 'http://127.0.0.1:3001'

    const client = WebsocketStream('ws://localhost:' + PORT)
    client.setEncoding('utf8')
    client.write('ping')

    client.once('data', (chunk) => {
      expect(chunk).to.be.equals('pong')
      client.destroy()
      done()
    })

    const mock = new MockAdapter(hub.httpClient)

    const callbackUrlCall = Sinon.spy()

    mock.onPost(callbackUrl).reply(function (config) {
      callbackUrlCall()
      return [200, config.data]
    })

    Axios.default.post(`http://localhost:${PORT}/subscribe`, {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds',
      'hub.protocol': 'ws'
    }).then((response) => {
      expect(response.status).to.be.equals(200)
      expect(callbackUrlCall.called).to.be.equals(true)
      mock.restore()
    })
  })
})
