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
