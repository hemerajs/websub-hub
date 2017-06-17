'use strict'

const Axios = require('axios')
const Hoek = require('hoek')

const defaultOptions = {
  timeout: 2000,
  hubUrl: ''
}

function Publisher (options) {
  this.options = Hoek.applyToDefaults(defaultOptions, options || {})
  this.httpClient = Axios.create({
    timeout: this.options.timeout
  })
}

Publisher.prototype.publish = function (url) {
  return this.httpClient.post(this.options.hubUrl + '/publish', {
    'hub.mode': 'publish',
    'hub.url': url
  })
}

module.exports = Publisher
