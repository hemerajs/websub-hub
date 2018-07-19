'use strict'

const Got = require('got')
const Hoek = require('hoek')

const defaultOptions = {
  timeout: 2000,
  hubUrl: ''
}

function Publisher(options) {
  this.options = Hoek.applyToDefaults(defaultOptions, options || {})
  this.httpClient = Got
}

Publisher.prototype.publish = function(url) {
  return this.httpClient.post(this.options.hubUrl + '/publish', {
    form: true,
    body: {
      'hub.mode': 'publish',
      'hub.url': url
    }
  })
}

module.exports = Publisher
