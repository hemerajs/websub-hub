'use strict'

const Code = require('code')
const expect = Code.expect
const Axios = require('axios')
const Hub = require('./../packages/websub-hub')
const MongoInMemory = require('mongo-in-memory')
const MockAdapter = require('axios-mock-adapter')

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
        requestTimeout: 500,
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

  it('Should not be able to publish to topic because topic endpoint does not respond with 2xx Status code', function () {
    const callbackUrl = 'http://127.0.0.1:3001'

    const mock = new MockAdapter(hub.httpClient)

    mock.onPost(callbackUrl).reply(function (config) {
      return [200, config.data]
    })

    mock.onGet(topic + '/feeds').reply(500)

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
        mock.restore()
      })
    })
  })

  it('Should be able to publish to topic and distribute content to subscribers', function () {
    const callbackUrl = 'http://127.0.0.1:3002'

    const mock = new MockAdapter(hub.httpClient)

    mock.onPost(callbackUrl).replyOnce(function (config) {
      return [200, config.data]
    })

    mock.onPost(callbackUrl).replyOnce(200)

    mock.onGet(topic + '/feeds').reply(200, {
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
    })

    // Create subscription and topic
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
        mock.restore()
      })
    })
  })
})
