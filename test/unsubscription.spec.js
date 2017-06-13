'use strict'

const Code = require('code')
const expect = Code.expect
const Axios = require('axios')
const Hub = require('./../packages/websub-hub')
const MongoInMemory = require('mongo-in-memory')
const MockAdapter = require('axios-mock-adapter')
const Sinon = require('sinon')

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

  it('Should be able to unsubscribe an active subscription', function () {
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
      return Axios.default.post(`http://localhost:${PORT}/subscribe`, {
        'hub.callback': callbackUrl,
        'hub.mode': 'unsubscribe',
        'hub.topic': topic + '/feeds'
      }).then((response) => {
        expect(response.status).to.be.equals(200)
        expect(callbackUrlCall.called).to.be.equals(true)
        mock.restore()
      })
    })
  })

  it('Should respond with 200 also when subscription does not exist', function () {
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
      return Axios.default.post(`http://localhost:${PORT}/subscribe`, {
        'hub.callback': callbackUrl,
        'hub.mode': 'unsubscribe',
        'hub.topic': topic + '/blog/feeds'
      }).catch((error) => {
        expect(error.response.status).to.be.equals(200)
        expect(callbackUrlCall.called).to.be.equals(true)
        mock.restore()
      })
    })
  })

  it('Should not be able to unsubscribe an active subscription because subscriber does not respond with 2xx', function () {
    const callbackUrl = 'http://127.0.0.1:3001'

    const mock = new MockAdapter(hub.httpClient)

    const callbackUrlCall = Sinon.spy()
    const callbackUrlCall2 = Sinon.spy()

    mock.onPost(callbackUrl).replyOnce(function (config) {
      callbackUrlCall()
      return [200, config.data]
    })

    mock.onPost(callbackUrl).replyOnce(function (config) {
      callbackUrlCall2()
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
        expect(callbackUrlCall.called).to.be.equals(true)
        expect(callbackUrlCall2.called).to.be.equals(true)
        mock.restore()
      })
    })
  })

  it('Should not be able to unsubscribe an active subscription because subscriber respond with wrong challenge', function () {
    const callbackUrl = 'http://127.0.0.1:3001'

    const mock = new MockAdapter(hub.httpClient)

    const callbackUrlCall = Sinon.spy()
    const callbackUrlCall2 = Sinon.spy()

    mock.onPost(callbackUrl).replyOnce(function (config) {
      callbackUrlCall()
      return [200, config.data]
    })

    // respond with wrong challenge key
    mock.onPost(callbackUrl).replyOnce(function (config) {
      const data = JSON.parse(config.data)
      data['hub.challenge'] = '123'
      callbackUrlCall2()
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
      .catch((error) => {
        expect(error.response.status).to.be.equals(403)
        expect(callbackUrlCall.called).to.be.equals(true)
        expect(callbackUrlCall2.called).to.be.equals(true)
        mock.restore()
      })
    })
  })
})
