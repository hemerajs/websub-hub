'use strict'

const Got = require('got')
const Hoek = require('hoek')

const defaultOptions = {
  timeout: 2000,
  baseUrl: ''
}

function Publisher(options) {
  this.options = Hoek.applyToDefaults(defaultOptions, options || {})
  this.httpClient = Got
}

Publisher.prototype.publish = function(url) {
  return this.httpClient.post(this.options.baseUrl + '/publish', {
    'hub.mode': 'publish',
    'hub.url': url
  })
}

module.exports = Publisher
