'use strict'

const Code = require('code')
const expect = Code.expect
const Axios = require('axios')
const Hub = require('./../packages/websub-hub')
const MongoInMemory = require('mongo-in-memory')
const MockAdapter = require('axios-mock-adapter')
const Sinon = require('sinon')

describe('Basic Subscription list', function () {
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

  it('Should return list of all active subscriptions', function () {
    const callbackUrl = 'http://127.0.0.1:3001'

    const mock = new MockAdapter(hub.httpClient)

    const callbackUrlCall = Sinon.spy()

    mock.onPost(callbackUrl).reply(function (config) {
      callbackUrlCall()
      return [200, config.data]
    })

    return Axios.default.post(`http://localhost:${PORT}/subscribe`, {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }).then((response) => {
      expect(response.status).to.be.equals(200)
      expect(callbackUrlCall.called).to.be.equals(true)
      return Axios.default.get(`http://localhost:${PORT}/subscriptions`).then((response) => {
        expect(response.data.length).to.be.equals(1)
        expect(response.data[0].callbackUrl).to.be.equals('http://127.0.0.1:3001')
        mock.restore()
      })
    })
  })
})
