'use strict'

const Got = require('got')
const Hoek = require('hoek')

const defaultOptions = {
  timeout: 2000,
  hubUrl: ''
}

module.exports = function build(options) {
  options = Hoek.applyToDefaults(defaultOptions, options || {})

  const publisher = {}
  publisher.httpClient = Got
  publisher.publish = publish

  return publisher

  function publish(url) {
    return this.httpClient.post(options.hubUrl + '/publish', {
      form: true,
      body: {
        'hub.mode': 'publish',
        'hub.url': url
      }
    })
  }
}
