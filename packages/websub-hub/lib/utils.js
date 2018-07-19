'use strict'

const Url = require('url')

module.exports.normalizeUrl = function(url) {
  const parsedUrl = Url.parse(url, true)

  const query = parsedUrl.query
  // remove query to get a normalized url without query params
  parsedUrl.search = ''
  parsedUrl.query = {}

  return {
    url: Url.format(parsedUrl, {
      search: false,
      fragment: false
    }),
    protocol: parsedUrl.protocol,
    query
  }
}
