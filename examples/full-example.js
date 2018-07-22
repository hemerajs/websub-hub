'use strict'

const Subscriber = require('../packages/websub-hub/subscriber')
const Publisher = require('../packages/websub-hub/publisher')

const hub = require('./hub')
const callback = require('./callback')
const feed = require('./blog')

async function start() {
  await hub()
  await callback()
  await feed()

  const sub = new Subscriber({
    hubUrl: 'http://127.0.0.1:3000'
  })

  await sub.unsubscribe('http://localhost:6000/feeds', 'http://localhost:5000')
  await sub.subscribe('http://localhost:6000/feeds', 'http://localhost:5000')

  const pub = new Publisher({
    hubUrl: 'http://127.0.0.1:3000'
  })
  await pub.publish('http://localhost:6000/feeds')
}

start().catch(err => {
  console.error(err)
  process.exit(1)
})
