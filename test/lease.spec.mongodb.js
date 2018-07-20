'use strict'

const Code = require('code')
const expect = Code.expect
const Got = require('got')
const Hub = require('./../packages/websub-hub')
const MongoInMemory = require('mongo-in-memory')
const Sinon = require('sinon')
const Nock = require('nock')
const { parse } = require('url')
const delay = require('delay')
const MongoClient = require('mongodb').MongoClient

describe('TTL subscriptions', function() {
  // The background task that removes expired documents runs every 60 seconds.
  // As a result, documents may remain in a collection during the period between the expiration of the document and the running of the background task.
  this.timeout(65000)

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

  before(done => {
    MongoClient.connect(
      mongoInMemory.getMongouri('hub'),
      function onConnect(err, client) {
        if (err) {
          done(err)
          return
        }
        const db = client.db('admin')
        db.command(
          { setParameter: 1, ttlMonitorSleepSecs: 5 },
          (err, result) => {
            if (err) {
              done(err)
              return
            }
            done()
          }
        )
      }
    )
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
      form: true,
      body: createSubscriptionBody
    })

    expect(response.statusCode).to.be.equals(200)

    await delay(60000)

    response = await Got.get(`http://localhost:${PORT}/subscriptions`, {
      json: true
    })

    console.log(response.body)
    expect(response.body.length).to.be.equals(0)

    verifyIntentMock.done()
  })

  it('Subscriber can re-request the subscription in order to renew the subscription', async function() {})
})
