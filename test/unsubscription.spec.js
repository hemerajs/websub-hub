'use strict'

const Code = require('code')
const expect = Code.expect
const Axios = require('axios')
const Hub = require('./../')
const MongoInMemory = require('mongo-in-memory')
const MockAdapter = require('axios-mock-adapter')

describe('Basic Unsubscription', function () {
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

  it('Should be able to unsubscribe an active subscription', function () {
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
        'hub.mode': 'unsubscribe',
        'hub.topic': topic + '/feeds'
      }).then((response) => {
        expect(response.status).to.be.equals(200)
        mock.restore()
      })
    })
  })

  it('Should respond with 404 because subscription does not exist', function () {
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
        'hub.mode': 'unsubscribe',
        'hub.topic': topic + '/blog/feeds'
      }).catch((error) => {
        expect(error.response.status).to.be.equals(404)
        mock.restore()
      })
    })
  })

  it('Should not be able to unsubscribe an active subscription because subscriber does not respond with 2xx', function () {
    const callbackUrl = 'http://127.0.0.1:3001'

    const mock = new MockAdapter(hub.httpClient)

    mock.onPost(callbackUrl).replyOnce(function (config) {
      return [200, config.data]
    })

    mock.onPost(callbackUrl).replyOnce(function (config) {
      return [401, config.data]
    })

    return Axios.default.post(`http://localhost:${PORT}/subscribe`, {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }).then((response) => {
      expect(response.status).to.be.equals(200)
      return Axios.default.post(`http://localhost:${PORT}/subscribe`, {
        'hub.callback': callbackUrl,
        'hub.mode': 'unsubscribe',
        'hub.topic': topic + '/feeds'
      }).catch((error) => {
        expect(error.response.status).to.be.equals(403)
        mock.restore()
      })
    })
  })

  it('Should not be able to unsubscribe an active subscription because subscriber respond with wrong challenge', function () {
    const callbackUrl = 'http://127.0.0.1:3001'

    const mock = new MockAdapter(hub.httpClient)

    mock.onPost(callbackUrl).replyOnce(function (config) {
      return [200, config.data]
    })

    // respond with wrong challenge key
    mock.onPost(callbackUrl).replyOnce(function (config) {
      const data = JSON.parse(config.data)
      data['hub.challenge'] = '123'
      return [200, JSON.stringify(data)]
    })

    return Axios.default.post(`http://localhost:${PORT}/subscribe`, {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }).then((response) => {
      expect(response.status).to.be.equals(200)
      return Axios.default.post(`http://localhost:${PORT}/subscribe`, {
        'hub.callback': callbackUrl,
        'hub.mode': 'unsubscribe',
        'hub.topic': topic + '/feeds'
      })
      .then((result) => {
        throw new Error('Action should fail!')
      })
      .catch((error) => {
        expect(error.response.status).to.be.equals(403)
        mock.restore()
      })
    })
  })
})
