<p align="center">
<img src="https://github.com/hemerajs/websub-hub/blob/master/media/logo.png?raw=true" alt="WebSub-Hub" style="max-width:100%;">
</p>

<p align="center">
<a href="https://badge.fury.io/js/websub-hub"><img src="https://camo.githubusercontent.com/48772c29d0514fc99d36e0a0d918c0d8298f9311/68747470733a2f2f62616467652e667572792e696f2f6a732f7765627375622d6875622e737667" alt="npm version" data-canonical-src="https://badge.fury.io/js/websub-hub.svg" style="max-width:100%;"></a>
<a href="https://travis-ci.org/hemerajs/websub-hub"><img src="https://travis-ci.org/hemerajs/websub-hub.svg?branch=master" alt="Build Status" data-canonical-src="https://travis-ci.org/hemerajs/websub-hub.svg?branch=master" style="max-width:100%;"></a>
<a href="https://standardjs.com"><img src="https://camo.githubusercontent.com/58fbab8bb63d069c1e4fb3fa37c2899c38ffcd18/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f636f64655f7374796c652d7374616e646172642d627269676874677265656e2e737667" alt="npm version" data-canonical-src="https://img.shields.io/badge/code_style-standard-brightgreen.svg" style="max-width:100%;"></a>
<a href="https://camo.githubusercontent.com/9df01034673d657d960eaced20b3c0b3241c2fc7/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f73746162696c6974792d6578706572696d656e74616c2d6f72616e67652e737667" target="_blank"><img src="https://camo.githubusercontent.com/9df01034673d657d960eaced20b3c0b3241c2fc7/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f73746162696c6974792d6578706572696d656e74616c2d6f72616e67652e737667" alt="stability" data-canonical-src="https://img.shields.io/badge/stability-experimental-orange.svg" style="max-width:100%;"></a>
</p>

<p align="center">
A WebSub Hub implementation in <a href="http://nodejs.org/">Node.js</a>
</p>

- __Node:__ 6.x, 7.x, 8.0
- __Lead Maintainer:__ [Dustin Deus](https://github.com/StarpTech)

## Expectations

- **Highly performant:** A single node can handle thousands of subscriptions.
- **Scalable:** Scale the hub in minutes. We choose monogdb as distributed storage.
- **Efficient:** Only distribute delta updates.
- **Websocket:** Use websockets to get updates in realtime.
- **Standardized** We're trying to be compliant with the W3C WebSub specification.
- **Developer friendly** Provide an easy interface to configure and use the hub.

## Specification
https://w3c.github.io/websub/

## Installation
```
$ docker run -d -p 27017:27017 -p 28017:28017 -e AUTH=no tutum/mongodb
$ npm i -g webpub-server
$ websub-hub -l info -m mongodb://localhost:27017/hub
```
## Getting started

```
$ node examples\server.js
$ node examples\feed.js
$ node examples\callback.js
```

## Subscribe
As soon as you want to subscribe to a topic you can initiate a subscription request. The subscriber has to verify that action as mentioned above.

```js
const Subscriber = require('websub-hub').subscriber
const s = new Subscriber({ hubUrl: 'http://127.0.0.1:3000' })
s.subscribe({
  topic: 'http://127.0.0.1:6000',
  callbackUrl: 'http://127.0.0.1:5000'
}).then((response) => {})
```

## Unsubscribe

```js
const Subscriber = require('websub-hub').subscriber
const s = new Subscriber({ hubUrl: 'http://127.0.0.1:3000' })
s.unsubscribe({
  topic: 'http://127.0.0.1:6000',
  callbackUrl: 'http://127.0.0.1:5000'
}).then((response) => {})
```

## Publish

```js
const Publisher = require('websub-hub').publisher
const p = new Publisher({ hubUrl: 'http://127.0.0.1:3000' })
p.publish('http://127.0.0.1:6000').then((response) => {})
```

## Test
```
$ npm run test
```
