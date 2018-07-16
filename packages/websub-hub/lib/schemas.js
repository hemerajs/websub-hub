'use strict'

// https://w3c.github.io/websub/#h-subscriber-sends-subscription-request
module.exports.subscriptionRequest = {
  body: {
    type: 'object',
    properties: {
      'hub.callback': { format: 'uri' },
      'hub.mode': { enum: ['subscribe', 'unsubscribe'] },
      'hub.topic': { format: 'uri' },
      'hub.lease_seconds': { type: 'integer' },
      'hub.secret': { type: 'string', minLength: 12 },
      'hub.format': {
        enum: ['json', 'xml'],
        default: 'json'
      }
    },
    required: ['hub.topic', 'hub.mode', 'hub.callback', 'hub.format']
  }
}

module.exports.publishingRequest = {
  body: {
    type: 'object',
    properties: {
      'hub.mode': { enum: ['publish'] },
      'hub.url': { type: 'string' }
    },
    required: ['hub.mode', 'hub.url']
  }
}
