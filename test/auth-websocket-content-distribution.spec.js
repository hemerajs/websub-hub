'use strict'

const Code = require('code')
const expect = Code.expect
const Got = require('got')
const Hub = require('./../packages/websub-hub')
const MongoInMemory = require('mongo-in-memory')
const Sinon = require('sinon')
const Nock = require('nock')
const Fs = require('fs')
const { parse } = require('url')
const WebSocket = require('ws')
const PEvent = require('p-event')
const Crypto = require('crypto')

describe('Websocket Authenticated Content Distribution', function() {
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
      ws: true,
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

  it('Should be able to distribute content with secret mechanism', function(done) {
    const callbackUrl = 'http://127.0.0.1:3002'
    const secret = '123456789101112'
    const createSubscriptionBody = {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds',
      'hub.ws': true,
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

    Got.post(`http://localhost:${PORT}/`, {
      form: true,
      body: createSubscriptionBody
    })
      .then(response => {
        expect(response.statusCode).to.be.equals(200)
      })
      .then(() => {
        return new WebSocket(`ws://localhost:${PORT}/`, {
          origin: `ws://localhost:${PORT}/`,
          headers: {
            'x-hub-topic': createSubscriptionBody['hub.topic'],
            'x-hub-callback': createSubscriptionBody['hub.callback']
          }
        })
      })
      .then(ws => {
        return PEvent(ws, 'open')
          .then(() => {
            ws.once('message', function incoming(data) {
              const msg = JSON.parse(data)
              const signature = msg.headers['x-hub-signature'].split('=')
              expect(signature[1]).to.be.equals(
                Crypto.createHmac(signature[0], secret)
                  .update(JSON.stringify(blogFeeds))
                  .digest('hex')
              )
              done()
            })
          })
          .then(() => {
            return Got.post(`http://localhost:${PORT}/publish`, {
              form: true,
              body: {
                'hub.mode': 'publish',
                'hub.url': topic + '/feeds'
              }
            })
          })
          .then(response => {
            expect(response.statusCode).to.be.equals(200)
            verifyIntentMock.done()
            topicContentMock.done()
          })
          .catch(done)
      })
  })
})
