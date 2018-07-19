'use strict'

const Code = require('code')
const expect = Code.expect
const Got = require('got')
const Hub = require('./../packages/websub-hub')
const MongoInMemory = require('mongo-in-memory')
const Sinon = require('sinon')
const Fs = require('fs')
const Path = require('path')
const Nock = require('nock')
const { parse } = require('url')
const getStream = require('get-stream')

describe('Content Stream', function() {
  const PORT = 3000
  let hub
  let mongoInMemory
  let topic = 'http://testblog.de'

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

  after(function(done) {
    hub.close().then(() => {
      mongoInMemory.stop(() => done())
    })
  })

  it('Should be able to stream json', async function() {
    const callbackUrl = 'http://127.0.0.1:3002'
    const blogFeeds = Fs.readFileSync(
      __dirname + '/fixtures/sample.json',
      'utf8'
    )
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
      .reply(
        200,
        function() {
          return Fs.createReadStream(
            Path.join(__dirname, 'fixtures/sample.json')
          )
        },
        {
          'Content-Type': 'application/json'
        }
      )

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
          `<http://localhost:3000>; rel="hub"; <${topic +
            '/feeds'}>; rel="self"`
        )
        expect(requestBody).to.be.equal(JSON.parse(blogFeeds))
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

  it('Should be able to stream xml', async function() {
    const callbackUrl = 'http://127.0.0.1:3002'
    const blogFeeds = Fs.readFileSync(
      __dirname + '/fixtures/sample.xml',
      'utf8'
    )
    const createSubscriptionBody = {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic + '/feeds/xml',
      'hub.format': 'xml'
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
      .get('/feeds/xml')
      .query(true)
      .reply(
        200,
        function() {
          return Fs.createReadStream(
            Path.join(__dirname, 'fixtures/sample.xml')
          )
        },
        {
          'Content-Type': 'application/rss+xml'
        }
      )

    let response = await Got.post(`http://localhost:${PORT}/`, {
      form: true,
      body: createSubscriptionBody
    })

    expect(response.statusCode).to.be.equals(200)

    const verifyPublishedContentMock = Nock(callbackUrl)
      .post('/')
      .query(true)
      .reply(200, function(uri, requestBody) {
        expect(this.req.headers['x-hub-signature']).to.be.not.exist()
        expect(this.req.headers['link']).to.be.equals(
          `<http://localhost:3000>; rel="hub"; <${topic +
            '/feeds/xml'}>; rel="self"`
        )
        expect(requestBody).to.be.equal(blogFeeds)
      })

    response = await Got.post(`http://localhost:${PORT}/publish`, {
      form: true,
      body: {
        'hub.mode': 'publish',
        'hub.url': topic + '/feeds/xml'
      }
    })

    expect(response.statusCode).to.be.equals(200)

    verifyIntentMock.done()
    topicContentMock.done()
    verifyPublishedContentMock.done()
  })
})
