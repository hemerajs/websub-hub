'use strict'

const Subscriber = require('../packages/websub-hub-subscriber')
const Publisher = require('../packages/websub-hub-publisher')

const hub = require('./hub')
const callback = require('./callback')
const feed = require('./blog')

const HUB_PORT = 3000

const publisher = Publisher({
  hubUrl: 'http://127.0.0.1:3000'
})
const subscriber = Subscriber({
  hubUrl: `http://127.0.0.1:${HUB_PORT}`
})

async function start() {
  await hub()
  await callback()
  await feed()

  await subscriber.unsubscribe(
    'http://localhost:6000/feeds',
    'http://localhost:5000'
  )
  await subscriber.subscribe(
    'http://localhost:6000/feeds',
    'http://localhost:5000'
  )

  await publisher.publish('http://localhost:6000/feeds')
}

start().catch(err => {
  console.error(err)
  process.exit(1)
})
