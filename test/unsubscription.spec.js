'use strict'

const Code = require('code')
const expect = Code.expect
const Got = require('got')
const Hub = require('./../packages/websub-hub')
const MongoInMemory = require('mongo-in-memory')
const Sinon = require('sinon')
const Nock = require('nock')
const { parse } = require('url')

describe('Basic Unsubscription', function() {
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

  it('Should be able to unsubscribe an active subscription', async function() {
    const callbackUrl = 'http://127.0.0.1:3001'
    const createSubscriptionBody = {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }

    const verifyIntentMock = Nock(callbackUrl)
      .get('/')
      .twice()
      .query(true)
      .reply(uri => {
        const query = parse(uri, true).query
        return [200, { ...query }]
      })

    let response = await Got.post(`http://localhost:${PORT}/`, {
      form: true,
      body: createSubscriptionBody
    })

    expect(response.statusCode).to.be.equals(200)

    response = await Got.post(`http://localhost:${PORT}/`, {
      form: true,
      body: {
        'hub.callback': callbackUrl,
        'hub.mode': 'unsubscribe',
        'hub.topic': topic + '/feeds'
      }
    })

    verifyIntentMock.done()
    expect(response.statusCode).to.be.equals(200)
  })

  it('Should not be able to unsubscribe an active subscription because subscriber does not respond with 2xx', async function() {
    const callbackUrl = 'http://127.0.0.1:3001'
    const createSubscriptionBody = {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }

    const verifySubscriptionIntentMock = Nock(callbackUrl)
      .get('/')
      .query(true)
      .reply(uri => {
        const query = parse(uri, true).query
        return [200, { ...query }]
      })

    let response = await Got.post(`http://localhost:${PORT}/`, {
      form: true,
      body: createSubscriptionBody
    })

    verifySubscriptionIntentMock.done()
    expect(response.statusCode).to.be.equals(200)

    const verifyUnsubscriptionIntentMock = Nock(callbackUrl)
      .get('/')
      .query(true)
      .reply(uri => {
        const query = parse(uri, true).query
        return [404]
      })

    try {
      response = await Got.post(`http://localhost:${PORT}/`, {
        form: true,
        body: {
          'hub.callback': callbackUrl,
          'hub.mode': 'unsubscribe',
          'hub.topic': topic + '/feeds'
        }
      })
    } catch (err) {
      expect(err.statusCode).to.be.equals(403)
    }
    verifyUnsubscriptionIntentMock.done()
  })

  it('Should not be able to unsubscribe an active subscription because subscriber respond with wrong challenge', async function() {
    const callbackUrl = 'http://127.0.0.1:3001'
    const createSubscriptionBody = {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }

    const verifySubscriptionIntentMock = Nock(callbackUrl)
      .get('/')
      .query(true)
      .reply(uri => {
        const query = parse(uri, true).query
        return [200, { ...query }]
      })

    let response = await Got.post(`http://localhost:${PORT}/`, {
      form: true,
      body: createSubscriptionBody
    })

    verifySubscriptionIntentMock.done()
    expect(response.statusCode).to.be.equals(200)

    const verifyUnsubscriptionIntentMock = Nock(callbackUrl)
      .get('/')
      .query(true)
      .reply(uri => {
        const query = parse(uri, true).query
        return [200, { ...query, ...{ 'hub.challenge': 'wrong' } }]
      })

    try {
      response = await Got.post(`http://localhost:${PORT}/`, {
        form: true,
        body: {
          'hub.callback': callbackUrl,
          'hub.mode': 'unsubscribe',
          'hub.topic': topic + '/feeds'
        }
      })
    } catch (err) {
      expect(err.statusCode).to.be.equals(403)
    }
    verifyUnsubscriptionIntentMock.done()
  })
})
