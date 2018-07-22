'use strict'

const Code = require('code')
const expect = Code.expect
const Got = require('got')
const Hub = require('./../packages/websub-hub')
const MongoInMemory = require('mongo-in-memory')
const Crypto = require('crypto')
const Sinon = require('sinon')
const Nock = require('nock')
const Fs = require('fs')
const { parse } = require('url')

describe('Authenticated Content Distribution', function() {
  const PORT = 3000
  let hub
  let mongoInMemory
  let topic = ''
  let counter = 0
  let secret = '123456'
  const blogFeeds = JSON.parse(
    Fs.readFileSync(__dirname + '/fixtures/sample.json', 'utf8')
  )

  before(done => {
    mongoInMemory = new MongoInMemory()
    mongoInMemory.start(() => done())
  })

  before(function() {
    hub = Hub({
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

  it('Should be able to distribute content with secret mechanism', async function() {
    const callbackUrl = 'http://127.0.0.1:3002'
    const secret = '123456789101112'
    const createSubscriptionBody = {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds',
      'hub.secret': secret
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

    const topicContentMock = Nock(topic)
      .get('/feeds')
      .query(true)
      .reply(200, blogFeeds)

    let response = await Got.post(`http://localhost:${PORT}/`, {
      form: true,
      body: createSubscriptionBody
    })

    expect(response.statusCode).to.be.equals(200)

    const verifyPublishedContentMock = Nock(callbackUrl)
      .post('/')
      .query(true)
      .reply(function(uri, requestBody) {
        expect(this.req.headers['x-hub-signature']).to.be.exist()
        const signature = this.req.headers['x-hub-signature'].split('=')
        expect(signature[1]).to.be.equals(
          Crypto.createHmac(signature[0], secret)
            .update(JSON.stringify(blogFeeds))
            .digest('hex')
        )
        expect(requestBody).to.be.equals(blogFeeds)
        return [200]
      })

    response = await Got.post(`http://localhost:${PORT}/publish`, {
      form: true,
      body: {
        'hub.mode': 'publish',
        'hub.url': topic + '/feeds'
      }
    })

    expect(response.statusCode).to.be.equals(200)

    verifyIntentMock.done()
    topicContentMock.done()
    verifyPublishedContentMock.done()
  })

  it('Subscriber has verified that the content was manipulated', async function() {
    const callbackUrl = 'http://127.0.0.1:3002'
    const secret = '123456789101112'
    const createSubscriptionBody = {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds',
      'hub.secret': secret
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

    const topicContentMock = Nock(topic)
      .get('/feeds')
      .query(true)
      .reply(200, blogFeeds)

    let response = await Got.post(`http://localhost:${PORT}/`, {
      form: true,
      body: createSubscriptionBody
    })

    expect(response.statusCode).to.be.equals(200)

    const verifyPublishedContentMock = Nock(callbackUrl)
      .post('/')
      .query(true)
      .reply(function(uri, requestBody) {
        expect(this.req.headers['x-hub-signature']).to.be.exist()
        const signature = this.req.headers['x-hub-signature'].split('=')
        expect(requestBody).to.be.equals(blogFeeds)

        if (
          Crypto.createHmac(signature[0], 'differentSecret')
            .update(JSON.stringify(blogFeeds))
            .digest('hex') !== signature[1]
        ) {
          return [401, '']
        }
        return [200, '']
      })

    try {
      response = await Got.post(`http://localhost:${PORT}/publish`, {
        form: true,
        body: {
          'hub.mode': 'publish',
          'hub.url': topic + '/feeds'
        }
      })
    } catch (err) {
      expect(err.statusCode).to.be.equals(400)
    }

    verifyIntentMock.done()
    topicContentMock.done()
    verifyPublishedContentMock.done()
  })
})
