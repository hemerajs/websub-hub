'use strict'

const Code = require('code')
const expect = Code.expect
const Got = require('got')
const Hub = require('./../packages/websub-hub').server
const MongoInMemory = require('mongo-in-memory')
const Sinon = require('sinon')
const Nock = require('nock')
const { parse } = require('url')
const delay = require('delay')

describe('Lease', function() {
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

  // Shutdown our server after we are done
  after(function(done) {
    hub.close().then(() => {
      mongoInMemory.stop(() => {
        done()
      })
    })
  })

  it('Should delete subscription when lease_seconds is over', async function() {
    const callbackUrl = 'http://127.0.0.1:3001'
    const createSubscriptionBody = {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds',
      'hub.lease_seconds': 1
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

    await delay(2000)

    response = await Got.get(`http://localhost:${PORT}/subscriptions`, {
      json: true
    })

    console.log(response.body)
    expect(response.body.length).to.be.equals(0)

    verifyIntentMock.done()
  })

  it('Subscriber can re-request the subscription in order to renew the subscription', async function() {})
})
