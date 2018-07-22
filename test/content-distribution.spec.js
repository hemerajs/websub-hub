'use strict'

const Code = require('code')
const expect = Code.expect
const Got = require('got')
const Hub = require('./../packages/websub-hub')
const MongoInMemory = require('mongo-in-memory')
const Sinon = require('sinon')
const Nock = require('nock')
const Delay = require('delay')
const Fs = require('fs')
const { parse } = require('url')

describe('Basic Content Distribution / Publishing', function() {
  const PORT = 3000
  let hub
  let mongoInMemory
  let topic = ''
  let counter = 0
  const blogFeeds = JSON.parse(
    Fs.readFileSync(__dirname + '/fixtures/sample.json', 'utf8')
  )

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

  it('Should not be able to publish because topic endpoint does not respond with success code', async function() {
    const callbackUrl = 'http://127.0.0.1:3002'
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

    const topicContentMock = Nock(topic)
      .get('/feeds')
      .query(true)
      .reply(404)

    let response = await Got.post(`http://localhost:${PORT}/`, {
      form: true,
      body: createSubscriptionBody
    })

    expect(response.statusCode).to.be.equals(200)

    try {
      await Got.post(`http://localhost:${PORT}/publish`, {
        form: true,
        body: {
          'hub.mode': 'publish',
          'hub.url': topic + '/feeds'
        }
      })
    } catch (err) {}

    verifyIntentMock.done()
    topicContentMock.done()
  })

  it('Should be able to publish to topic and distribute content to subscriber', async function() {
    const callbackUrl = 'http://127.0.0.1:3002'
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
        expect(this.req.headers['x-hub-signature']).to.be.not.exist()
        expect(this.req.headers['link']).to.be.equals(
          `<http://localhost:3000>; rel="hub", <${topic +
            '/feeds'}>; rel="self"`
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

    await Delay(100)

    expect(response.statusCode).to.be.equals(200)

    verifyIntentMock.done()
    topicContentMock.done()
    verifyPublishedContentMock.done()
  })

  it('Should receive the correct query paramaters when the hub initiated a verification request', async function() {
    const callbackUrl = 'http://127.0.0.1:3002'
    const createSubscriptionBody = {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }

    const verifyIntentMock = Nock(callbackUrl)
      .get('/')
      .query(true)
      .reply(function(uri) {
        const query = parse(uri, true).query
        expect(query['hub.challenge']).to.be.exists()
        expect(query['hub.topic']).to.be.equal(
          createSubscriptionBody['hub.topic']
        )
        expect(query['hub.mode']).to.be.equal(
          createSubscriptionBody['hub.mode']
        )
        expect(query['hub.lease_seconds']).to.be.equal('864000') // 10 days
        return [
          200,
          { ...createSubscriptionBody, 'hub.challenge': query['hub.challenge'] }
        ]
      })

    let response = await Got.post(`http://localhost:${PORT}/`, {
      form: true,
      body: createSubscriptionBody
    })

    expect(response.statusCode).to.be.equals(200)

    verifyIntentMock.done()
  })

  it('Should request callbackUrl with query parameters', async function() {
    const callbackUrl = 'http://127.0.0.1:3002?foo=bar'
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
        expect(query.foo).to.be.equal('bar')
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
        const query = parse(uri, true).query
        expect(query.foo).to.be.equal('bar')
        return [200]
      })

    response = await Got.post(`http://localhost:${PORT}/publish`, {
      form: true,
      body: {
        'hub.mode': 'publish',
        'hub.url': topic + '/feeds'
      }
    })

    await Delay(100)

    expect(response.statusCode).to.be.equals(200)

    verifyIntentMock.done()
    topicContentMock.done()
    verifyPublishedContentMock.done()
  })

  it('Should not abort the distribution process when one subscriber return none-success status code', async function() {
    const callbackUrl1 = 'http://127.0.0.1:3002'
    const callbackUrl2 = 'http://127.0.0.1:3003'
    const createSubscriptionBody1 = {
      'hub.callback': callbackUrl1,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }
    const createSubscriptionBody2 = {
      'hub.callback': callbackUrl2,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }

    const verifyIntentMockForSubscriber1 = Nock(callbackUrl1)
      .get('/')
      .query(true)
      .reply(uri => {
        const query = parse(uri, true).query
        return [
          200,
          {
            ...createSubscriptionBody1,
            'hub.challenge': query['hub.challenge']
          }
        ]
      })

    const verifyIntentMockForSubscriber2 = Nock(callbackUrl2)
      .get('/')
      .query(true)
      .reply(uri => {
        const query = parse(uri, true).query
        return [
          200,
          {
            ...createSubscriptionBody2,
            'hub.challenge': query['hub.challenge']
          }
        ]
      })

    const topicContentMock = Nock(topic)
      .get('/feeds')
      .twice() // both subscription will request for it
      .query(true)
      .reply(200, blogFeeds)

    let response = await Got.post(`http://localhost:${PORT}/`, {
      form: true,
      body: createSubscriptionBody1
    })

    expect(response.statusCode).to.be.equals(200)

    response = await Got.post(`http://localhost:${PORT}/`, {
      form: true,
      body: createSubscriptionBody2
    })

    expect(response.statusCode).to.be.equals(200)

    const verifyPublishedContentForSubscriber1Mock = Nock(callbackUrl1)
      .post('/')
      .query(true)
      .reply(function(uri, requestBody) {
        expect(requestBody).to.be.equals(blogFeeds)
        return [200]
      })

    const verifyPublishedContentForSubscriber2Mock = Nock(callbackUrl2)
      .post('/')
      .query(true)
      .reply(function(uri, requestBody) {
        expect(requestBody).to.be.equals(blogFeeds)
        return [500]
      })

    response = await Got.post(`http://localhost:${PORT}/publish`, {
      form: true,
      body: {
        'hub.mode': 'publish',
        'hub.url': topic + '/feeds'
      }
    })

    await Delay(100)

    expect(response.statusCode).to.be.equals(200)

    verifyIntentMockForSubscriber1.done()
    verifyIntentMockForSubscriber2.done()
    verifyPublishedContentForSubscriber1Mock.done()
    verifyPublishedContentForSubscriber2Mock.done()

    topicContentMock.done()
  })
})
