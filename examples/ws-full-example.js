'use strict'

const Subscriber = require('../packages/websub-hub-subscriber')
const Publisher = require('../packages/websub-hub-publisher')
const PEvent = require('p-event')
const WebSocket = require('ws')

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
  await hub({ ws: true })
  await callback()
  await feed()

  await subscriber.unsubscribe(
    'http://localhost:6000/feeds',
    'http://localhost:5000'
  )
  await subscriber.subscribe(
    'http://localhost:6000/feeds',
    'http://localhost:5000',
    true
  )

  const ws = new WebSocket(`ws://localhost:${HUB_PORT}/`, {
    origin: `ws://localhost:${HUB_PORT}/`,
    headers: {
      'x-hub-topic': 'http://localhost:6000/feeds',
      'x-hub-callback': 'http://localhost:5000'
    }
  })

  await PEvent(ws, 'open')

  ws.on('close', function incoming() {
    console.log('connection closed')
  })

  ws.on('message', function incoming(data) {
    const msg = JSON.parse(data)
    console.log('message received')
    console.log(msg)
  })

  await publisher.publish('http://localhost:6000/feeds')
}

start().catch(err => {
  console.error(err)
  process.exit(1)
})
