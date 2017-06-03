'use strict'

module.exports.postSubscription = {
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
