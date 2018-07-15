'use strict'

const Code = require('code')
const expect = Code.expect
const Got = require('got')
const Hub = require('./../packages/websub-hub').server
const MongoInMemory = require('mongo-in-memory')
const Sinon = require('sinon')
const Fs = require('fs')
const Path = require('path')

describe.only('Content Stream', function() {
  const PORT = 3000
  let hub
  let mongoInMemory
  let topic = 'http://testblog.de'

  before(function(done) {
    mongoInMemory = new MongoInMemory()
    mongoInMemory.start(() => {
      hub = new Hub({
        timeout: 500,
        logLevel: 'debug',
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
  after(function(done) {
    hub.close().then(() => {
      mongoInMemory.stop(() => {
        done()
      })
    })
  })

  it('Should be able to stream json', function() {
    const callbackUrl = 'http://127.0.0.1:3002'

    const mock = new MockAdapter(hub.httpClient)

    const callbackUrlCall = Sinon.spy()
    const distributeContentCall = Sinon.spy()

    mock.onPost(callbackUrl).replyOnce(function(config) {
      callbackUrlCall()
      return [200, config.data]
    })

    mock.onPost(callbackUrl).replyOnce(function(config) {
      distributeContentCall()
      return [200]
    })

    mock
      .onGet(topic + '/feeds')
      .reply(
        200,
        Fs.createReadStream(Path.join(__dirname, 'fixtures/sample.json')),
        {
          'Content-Type': 'application/json'
        }
      )

    // Create subscription and topic
    return Got.post(`http://localhost:${PORT}/subscribe`, {
      body: {
        'hub.callback': callbackUrl,
        'hub.mode': 'subscribe',
        'hub.topic': topic + '/feeds'
      }
    })
      .then(response => {
        expect(response.status).to.be.equals(200)
      })
      .then(() => {
        return Got.post(`http://localhost:${PORT}/publish`, {
          body: {
            'hub.mode': 'publish',
            'hub.url': topic + '/feeds'
          }
        }).then(response => {
          expect(response.status).to.be.equals(200)

          expect(callbackUrlCall.called).to.be.equals(true)
          expect(distributeContentCall.called).to.be.equals(true)
          mock.restore()
        })
      })
  })

  it('Should be able to stream xml', function() {
    const callbackUrl = 'http://127.0.0.1:3002'

    const mock = new MockAdapter(hub.httpClient)

    const callbackUrlCall = Sinon.spy()
    const distributeContentCall = Sinon.spy()

    mock.onPost(callbackUrl).replyOnce(function(config) {
      callbackUrlCall()
      return [200, config.data]
    })

    mock.onPost(callbackUrl).replyOnce(function(config) {
      distributeContentCall()
      return [200]
    })

    mock
      .onGet(topic + '/feeds')
      .reply(
        200,
        Fs.createReadStream(Path.join(__dirname, 'fixtures/sample.xml')),
        {
          'Content-Type': 'application/xml'
        }
      )

    // Create subscription and topic
    return Got.post(`http://localhost:${PORT}/subscribe`, {
      body: {
        'hub.callback': callbackUrl,
        'hub.mode': 'subscribe',
        'hub.topic': topic + '/feeds',
        'hub.format': 'xml'
      }
    })
      .then(response => {
        expect(response.status).to.be.equals(200)
      })
      .then(() => {
        return Got.post(`http://localhost:${PORT}/publish`, {
          body: {
            'hub.mode': 'publish',
            'hub.url': topic + '/feeds'
          }
        }).then(response => {
          expect(response.status).to.be.equals(200)

          expect(callbackUrlCall.called).to.be.equals(true)
          expect(distributeContentCall.called).to.be.equals(true)
          mock.restore()
        })
      })
  })
})
