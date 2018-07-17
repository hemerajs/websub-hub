'use strict'

const Code = require('code')
const expect = Code.expect
const Got = require('got')
const Hub = require('./../packages/websub-hub').server
const MongoInMemory = require('mongo-in-memory')
const Sinon = require('sinon')
const Nock = require('nock')
const { parse } = require('url')

describe('Basic Subscription', function() {
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

  it('Should respond with 403 because intent could not be verified', async function() {
    const callbackUrl = 'http://127.0.0.1:3001'
    const createSubscriptionBody = {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds'
    }

    const verifyIntentMock = Nock(callbackUrl)
      .get('/')
      .query(true)
      .reply((uri, requestBody) => {
        return [200, { ...createSubscriptionBody, 'hub.challenge': 'wrong' }]
      })

    try {
      await Got.post(`http://localhost:${PORT}/`, {
        body: createSubscriptionBody
      })
    } catch (err) {
      expect(err.statusCode).to.be.equals(403)
      verifyIntentMock.done()
    }
  })

  it('Should respond with 200 because intent could be verified', async function() {
    const callbackUrl = 'http://127.0.0.1:3001'
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
    verifyIntentMock.done()
  })

  it('Should be able to subscribe multiple times with the same subscriber', async function() {
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
        return [
          200,
          { ...createSubscriptionBody, 'hub.challenge': query['hub.challenge'] }
        ]
      })

    let response = await Got.post(`http://localhost:${PORT}/`, {
      body: createSubscriptionBody
    })

    expect(response.statusCode).to.be.equals(200)

    response = await Got.post(`http://localhost:${PORT}/`, {
      body: createSubscriptionBody
    })

    expect(response.statusCode).to.be.equals(200)

    verifyIntentMock.done()
  })
})
