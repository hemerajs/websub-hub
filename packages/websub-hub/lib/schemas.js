'use strict'

// https://w3c.github.io/websub/#h-subscriber-sends-subscription-request
module.exports.subscriptionRequest = {
  body: {
    type: 'object',
    properties: {
      'hub.callback': { format: 'uri' },
      'hub.mode': { enum: ['subscribe', 'unsubscribe', 'publish'] },
      'hub.topic': { format: 'uri' },
      'hub.lease_seconds': { type: 'integer' },
      'hub.secret': { type: 'string', minLength: 12 },
      'hub.url': { format: 'uri' },
      'hub.format': {
        enum: ['json', 'xml'],
        default: 'json'
      }
    }
  }
}
