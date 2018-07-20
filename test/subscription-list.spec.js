'use strict'

const Code = require('code')
const expect = Code.expect
const Got = require('got')
const Hub = require('./../packages/websub-hub')
const MongoInMemory = require('mongo-in-memory')
const Sinon = require('sinon')
const Nock = require('nock')
const { parse } = require('url')

describe('Basic Subscription list', function() {
  const PORT = 3000
  let hub
  let mongoInMemory
  let topic = ''
  let counter = 0

  before(done => {
    mongoInMemory = new MongoInMemory()
    mongoInMemory.start(() => done())
  })

  before(function() {
    hub = Hub({
      timeout: 500,
      logLevel: 'debug',
      mongo: {
        url: mongoInMemory.getMongouri('hub')
      }
    })
    return hub.listen()
  })

  // In order to produce unique subscriptions
  beforeEach(() => {
    topic = `http://testblog-n${counter++}.de`
  })

  after(function(done) {
    hub.close().then(() => {
      mongoInMemory.stop(() => done())
    })
  })

  it('Should return list of all active subscriptions', async function() {
    const callbackUrl = 'http://127.0.0.1:3002'
    const blogFeeds = {
      version: 'https://jsonfeed.org/version/1',
      title: 'My Example Feed',
      updated: '2003-12-13T18:30:02Z',
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
    }
    const createSubscriptionBody = {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }

    const verifyIntentMock = Nock(callbackUrl)
      .get('/')
      .query(true)
      .reply(uri => {
        const query = parse(uri, true).query
        return [
          200,
          { ...createSubscriptionBody, 'hub.challenge': query['hub.challenge'] }
        ]
      })

    let response = await Got.post(`http://localhost:${PORT}/`, {
      body: createSubscriptionBody
    })

    expect(response.statusCode).to.be.equals(200)

    response = await Got.get(`http://localhost:${PORT}/subscriptions`, {
      json: true
    })
    expect(response.body.length).to.be.equals(1)
    expect(response.body[0].callbackUrl).to.be.equals('http://127.0.0.1:3002/')

    verifyIntentMock.done()
  })
})
