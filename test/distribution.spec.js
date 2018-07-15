'use strict'

const Code = require('code')
const expect = Code.expect
const Got = require('got')
const Hub = require('./../packages/websub-hub').server
const MongoInMemory = require('mongo-in-memory')
const Sinon = require('sinon')

describe('Basic Content Distribution', function() {
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

  after(function(done) {
    hub.close().then(() => {
      mongoInMemory.stop(() => {
        done()
      })
    })
  })

  it('Should be able to distribute content', function() {
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

    mock.onGet(topic + '/feeds').reply(200, {
      version: 'https://jsonfeed.org/version/1',
      title: 'My Example Feed',
      home_page_url: 'https://example.org/',
      feed_url: 'https://example.org/feed.json',
      items: [
        {
          id: '2',
          content_text: 'This is a second item.',
          url: 'https://example.org/second-item'
        },
        {
          id: '1',
          content_html: '<p>Hello, world!</p>',
          url: 'https://example.org/initial-post'
        }
      ]
    })

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
})
