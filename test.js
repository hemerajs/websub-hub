'use strict'

const Code = require('code')
const expect = Code.expect
const Request = require('request')
const Hub = require('./server')

describe('Basic', function () {
  const PORT = 3000
  let hub

  // Start up our own nats-server
  before(function (done) {
    hub = new Hub()
    hub.listen(PORT, done)
  })

  // Shutdown our server after we are done
  after(function (done) {
    hub.close(done)
  })

  it('Should not create subscription because intent could not be verified', function (done) {
    Request({
      method: 'POST',
      uri: `http://localhost:${PORT}/subscribe`,
      form: {
        'hub.callback': 'http://127.0.0.1:3001',
        'hub.mode': 'subscribe',
        'hub.topic': 'http://blog.de/feeds'
      },
      json: true
    }, (err, response, body) => {
      expect(403).to.be.equals(response.statusCode)
      expect(403).to.be.equals(body.statusCode)
      expect('Forbidden').to.be.equals(body.error)
      expect('Subscriber has return an invalid answer').to.be.equals(body.message)
      done()
    })
  })
})
