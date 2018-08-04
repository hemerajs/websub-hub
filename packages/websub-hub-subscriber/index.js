'use strict'

const Hoek = require('hoek')
const Got = require('got')

const defaultOptions = {
  timeout: 2000,
  hubUrl: ''
}

module.exports = function build(options) {
  options = Hoek.applyToDefaults(defaultOptions, options || {})

  const subscriber = {}
  subscriber.httpClient = Got.extend({
    timeout: options.timeout,
    baseUrl: options.hubUrl,
    form: true
  })
  subscriber.subscribe = subscribe
  subscriber.unsubscribe = unsubscribe
  subscriber.list = list

  return subscriber

  function subscribe(topic, callbackUrl, useWebsocket) {
    return this.httpClient.post('/', {
      body: {
        'hub.callback': callbackUrl,
        'hub.mode': 'subscribe',
        'hub.topic': topic,
        'hub.ws': !!useWebsocket
      }
    })
  }

  function unsubscribe(topic, callbackUrl) {
    return this.httpClient.post('/', {
      body: {
        'hub.callback': callbackUrl,
        'hub.mode': 'unsubscribe',
        'hub.topic': topic
      }
    })
  }

  function list(start, limit) {
    return this.httpClient.get('/subscriptions', {
      query: { start, limit }
    })
  }
}
