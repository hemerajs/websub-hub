'use strict'

const Code = require('code')
const expect = Code.expect
const Axios = require('axios')
const Hub = require('./../packages/websub-hub')
const MongoInMemory = require('mongo-in-memory')
const MockAdapter = require('axios-mock-adapter')

describe('Basic Subscription', function () {
  const PORT = 3000
  let hub
  let mongoInMemory
  let topic = 'http://testblog.de'

  // Start up our own nats-server
  before(function (done) {
    mongoInMemory = new MongoInMemory()
    mongoInMemory.start(() => {
      hub = new Hub({
        requestTimeout: 500,
        server: {
          port: PORT
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

  it('Should respond with 403 because intent could not be verified', function () {
    return Axios.default.post(`http://localhost:${PORT}/subscribe`, {
      'hub.callback': 'http://127.0.0.1:3001',
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }).catch((error) => {
      expect(error.response.status).to.be.equals(403)
      expect(error.response.data.statusCode).to.be.equals(403)
      expect(error.response.data.error).to.be.equals('Forbidden')
      expect(error.response.data.message).to.be.equals('Subscriber has return an invalid answer')
    })
  })

  it('Should respond with 200 because intent could be verified', function () {
    const callbackUrl = 'http://127.0.0.1:3001'

    const mock = new MockAdapter(hub.httpClient)

    mock.onPost(callbackUrl).reply(function (config) {
      return [200, config.data]
    })

    return Axios.default.post(`http://localhost:${PORT}/subscribe`, {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }).then((response) => {
      expect(response.status).to.be.equals(200)
      mock.restore()
    })
  })

  it('Should be able to subscribe multiple times with the same subscriber', function () {
    const callbackUrl = 'http://127.0.0.1:3001'

    const mock = new MockAdapter(hub.httpClient)

    mock.onPost(callbackUrl).reply(function (config) {
      return [200, config.data]
    })

    return Axios.default.post(`http://localhost:${PORT}/subscribe`, {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }).then((response) => {
      expect(response.status).to.be.equals(200)
      return Axios.default.post(`http://localhost:${PORT}/subscribe`, {
        'hub.callback': callbackUrl,
        'hub.mode': 'subscribe',
        'hub.topic': topic + '/feeds'
      }).then((response) => {
        expect(response.status).to.be.equals(200)
        mock.restore()
      })
    })
  })
})
