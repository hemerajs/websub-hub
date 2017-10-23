'use strict'

// https://w3c.github.io/websub/#h-subscriber-sends-subscription-request
module.exports.subscriptionRequest = {
  body: {
    type: 'object',
    properties: {
      'hub.callback': { type: 'string' },
      'hub.mode': { enum: ['subscribe', 'unsubscribe'] },
      'hub.topic': { type: 'string' },
      'hub.lease_seconds': { type: 'integer' },
      'hub.secret': { type: 'string' },
      'hub.format': { type: 'string' }
    },
    required: ['hub.topic', 'hub.mode', 'hub.callback']
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
