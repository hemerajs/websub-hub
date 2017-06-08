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
  let topic = 'http://testblog.de'

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

  it('Should respond with 403 because intent could not be verified', function () {
    const callbackUrl = 'http://127.0.0.1:3001'

    Nock(callbackUrl)
    .post('/')
    .reply(500)

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

    Nock(callbackUrl)
    .post('/')
    .reply(200, function (uri, requestBody) {
      return requestBody
    })

    return Axios.default.post(`http://localhost:${PORT}/subscribe`, {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }).then((response) => {
      expect(response.status).to.be.equals(200)
    })
  })
})

describe('Basic Publishing', function () {
  const PORT = 3000
  let hub
  let mongoInMemory
  let topic = 'http://testblog.de'

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

  it('Should not be able to publish to topic because topic does not exist', function () {
    return Axios.default.post(`http://localhost:${PORT}/publish`, {
      'hub.mode': 'publish',
      'hub.url': topic + '/feeds'
    }).catch((error) => {
      expect(error.response.status).to.be.equals(404)
    })
  })

  it('Should not be able to publish to topic because topic endpoint does not respond with 2xx Status code', function () {
    const callbackUrl = 'http://127.0.0.1:3001'

    Nock(callbackUrl)
    .post('/')
    .reply(200, function (uri, requestBody) {
      return requestBody
    })

    Nock(topic)
    .get('/feeds')
    .reply(500)

    // Create subscriptiona and topic
    return Axios.default.post(`http://localhost:${PORT}/subscribe`, {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }).then((response) => {
      expect(response.status).to.be.equals(200)
    })
    .then(() => {
      Axios.default.post(`http://localhost:${PORT}/publish`, {
        'hub.mode': 'publish',
        'hub.url': topic + '/feeds'
      }).catch((error) => {
        expect(error.response.status).to.be.equals(503)
      })
    })
  })

  it('Should be able to publish to topic', function () {
    const callbackUrl = 'http://127.0.0.1:3002'

    Nock(callbackUrl)
    .post('/')
    .reply(200, function (uri, requestBody) {
      return requestBody
    })

    Nock(topic)
    .get('/feeds')
    .reply(200, function (uri, requestBody) {
      return {
        'version': 'https://jsonfeed.org/version/1',
        'title': 'My Example Feed',
        'home_page_url': 'https://example.org/',
        'feed_url': 'https://example.org/feed.json',
        'items': [
          {
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
    })

    // Create subscriptiona and topic
    return Axios.default.post(`http://localhost:${PORT}/subscribe`, {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }).then((response) => {
      expect(response.status).to.be.equals(200)
    })
    .then(() => {
      return Axios.default.post(`http://localhost:${PORT}/publish`, {
        'hub.mode': 'publish',
        'hub.url': topic + '/feeds'
      }).then((response) => {
        expect(response.status).to.be.equals(200)
      })
    })
  })
})
