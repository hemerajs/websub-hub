'use strict'

const Code = require('code')
const expect = Code.expect
const Axios = require('axios')
const Hub = require('./../packages/websub-hub')
const MongoInMemory = require('mongo-in-memory')
const MockAdapter = require('axios-mock-adapter')
const Sinon = require('sinon')

describe('Auto pruning', function () {
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
        mongo: {
          url: mongoInMemory.getMongouri('hub')
        },
        retry: {
          retries: 3,
          minTimeout: 250,
          randomize: false
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

  it('Should delete subscription when subscriber doesnt return a valid answer after max retry', function () {
    const callbackUrl = 'http://127.0.0.1:3002'

    const mock = new MockAdapter(hub.httpClient)

    const callbackUrlCall = Sinon.spy()
    const distributeContentCall = Sinon.spy()

    mock.onPost(callbackUrl).replyOnce(function (config) {
      callbackUrlCall()
      return [200, config.data]
    })

    mock.onPost(callbackUrl).reply(function (config) {
      distributeContentCall()
      return [500]
    })

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
        // check retrys
        expect(callbackUrlCall.called).to.be.equals(true)
        expect(distributeContentCall.callCount).to.be.equals(4)
        // check if sub was removed
        return Axios.default.get(`http://localhost:${PORT}/subscriptions`).then((response) => {
          expect(response.data.length).to.be.equals(0)
          mock.restore()
        })
      })
    })
  })
})
