'use strict'

const Hoek = require('hoek')
const Got = require('got')

const defaultOptions = {
  timeout: 2000,
  hubUrl: ''
}

function Subscriber(options) {
  this.options = Hoek.applyToDefaults(defaultOptions, options || {})
  this.httpClient = Got
}

Subscriber.prototype.subscribe = function(topic, callbackUrl) {
  return this.httpClient.post(this.options.hubUrl, {
    form: true,
    body: {
      'hub.callback': callbackUrl,
      'hub.mode': 'subscribe',
      'hub.topic': topic
    }
  })
}

Subscriber.prototype.unsubscribe = function(topic, callbackUrl) {
  return this.httpClient.post(this.options.hubUrl, {
    form: true,
    body: {
      'hub.callback': callbackUrl,
      'hub.mode': 'unsubscribe',
      'hub.topic': topic
    }
  })
}

Subscriber.prototype.list = function(start, limit) {
  return this.httpClient.get(this.options.hubUrl + '/subscriptions', {
    query: { start, limit }
  })
}

module.exports = Subscriber
