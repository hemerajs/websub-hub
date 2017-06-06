'use strict'

const Code = require('code')
const expect = Code.expect
const Axios = require('axios')
const Nock = require('nock')
const Hub = require('./server')
const MongoInMemory = require('mongo-in-memory')

describe('Basic Subscription', function () {
  const PORT = 3000
  let hub
  let mongoInMemory

  // Start up our own nats-server
  before(function (done) {
    mongoInMemory = new MongoInMemory()
    mongoInMemory.start(() => {
      hub = new Hub({
        mongo: {
          url: mongoInMemory.getMongouri('hub')
        }
      })
      hub.listen(PORT).then(() => {
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

  it('Should respond with 403 because intent could not be verified', function (done) {
    const callbackUrl = 'http://127.0.0.1:3001'

    Nock(callbackUrl)
    .post('/')
    .reply(500)

    Axios.default.post(`http://localhost:${PORT}/subscribe`, {
      'hub.callback': 'http://127.0.0.1:3001',
      'hub.mode': 'subscribe',
      'hub.topic': 'http://blog.de/feeds'
    }).catch((error) => {
      expect(error.response.status).to.be.equals(403)
      expect(error.response.data.statusCode).to.be.equals(403)
      expect(error.response.data.error).to.be.equals('Forbidden')
      expect(error.response.data.message).to.be.equals('Subscriber has return an invalid answer')
      done()
    })
  })

  it('Should respond with 200 because intent could be verified', function (done) {
    const callbackUrl = 'http://127.0.0.1:3001'

    Nock(callbackUrl)
    .post('/')
    .reply(200, function (uri, requestBody) {
      return requestBody
    })

    Axios.default.post(`http://localhost:${PORT}/subscribe`, {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': 'http://blog.de/feeds'
    }).then((response) => {
      expect(response.status).to.be.equals(200)
      done()
    })
  })
})
