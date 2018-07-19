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

Subscriber.prototype.subscribe = function(subscription) {
  return this.httpClient.post(this.options.hubUrl + '/', {
    'hub.callback': subscription.callbackUrl,
    'hub.mode': 'subscribe',
    'hub.topic': subscription.topic
  })
}

Subscriber.prototype.unsubscribe = function(subscription) {
  return this.httpClient.post(this.options.hubUrl + '/', {
    'hub.callback': subscription.callbackUrl,
    'hub.mode': 'unsubscribe',
    'hub.topic': subscription.topic
  })
}

Subscriber.prototype.list = function(subscription) {
  return this.httpClient.get(this.options.hubUrl + '/subscriptions')
}

module.exports = Subscriber
