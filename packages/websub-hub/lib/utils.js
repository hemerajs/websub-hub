'use strict'

const Url = require('url')

module.exports.normalizeUrl = function(url) {
  const parsedUrl = Url.parse(url, true)

  const urlWithoutQuery = `${parsedUrl.protocol}//${parsedUrl.hostname}${
    parsedUrl.port ? ':' + parsedUrl.port : ''
  }${parsedUrl.pathname}`

  return {
    url: urlWithoutQuery,
    protocol: parsedUrl.protocol,
    query: parsedUrl.query
  }
}

module.exports.safeEqual = function(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return a === b
  }

  var maxLength = Math.max(a.length, b.length)

  // xor strings for security
  var mismatch = 0
  for (var i = 0; i < maxLength; ++i) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)

    // check after for perf, we don't want to
    // re-enter the loop if we have a failure.
    if (mismatch > 0) {
      break
    }
  }

  return !mismatch
}
