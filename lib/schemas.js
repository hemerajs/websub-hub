'use strict'

// https://w3c.github.io/websub/#h-subscriber-sends-subscription-request
module.exports.subscriptionRequest = {
  body: {
    type: 'object',
    properties: {
      'hub.callback': { format: 'url' },
      'hub.mode': { enum: ['susbcribe', 'unsubscribe'] },
      'hub.topic': { type: 'string' },
      'hub.lease_seconds': { type: 'integer' },
      'hub.secret': { type: 'string' }
    },
    'required': [ 'hub.topic', 'hub.mode', 'hub.callback' ]
  }
}
