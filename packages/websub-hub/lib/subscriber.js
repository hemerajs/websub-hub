'use strict'

const Hoek = require('hoek')
const Axios = require('axios')

const defaultOptions = {
  timeout: 2000,
  hubUrl: ''
}

function Subscriber (options) {
  this.options = Hoek.applyToDefaults(defaultOptions, options || {})
  this.httpClient = Axios.create({
    timeout: this.options.timeout
  })
}

Subscriber.prototype.subscribe = function (subscription) {
  return this.httpClient.post(this.options.hubUrl + '/subscribe', {
    'hub.callback': subscription.callbackUrl,
    'hub.mode': 'subscribe',
    'hub.topic': subscription.topic
  })
}

Subscriber.prototype.unsubscribe = function (subscription) {
  return this.httpClient.post(this.options.hubUrl + '/unsubscribe', {
    'hub.callback': subscription.callbackUrl,
    'hub.mode': 'unsubscribe',
    'hub.topic': subscription.topic
  })
}

Subscriber.prototype.list = function (subscription) {
  return this.httpClient.get(this.options.hubUrl + '/subscriptions')
}

module.exports = Subscriber
