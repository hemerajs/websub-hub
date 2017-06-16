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

- **Highly performant:** A single node should be able to handle thousand of subscriptions.
- **Scalable:** Should be easy to scale the hub. We choose monogdb as distributed storage.
- **Efficient:** Should be able to distribute only delta updates when possible.
- **Websocket:** Should be able to establish a websocket connection for best performance.
- **Standardized** We trying to be compliant with the W3C Websub specification.
- **Developer friendly** It should be easy to start and configure the hub and we want to provide an elegant api.

## Specification
https://w3c.github.io/websub/

## Installation
```
$ docker run -d -p 27017:27017 -p 28017:28017 -e AUTH=no tutum/mongodb
$ npm i -g webpub-server
$ websub-hub -l info -m mongodb://localhost:27017/hub
```
## Getting started

- Your `callbackUrl` endpoint should return the `hub.challenge` with 2xx statusCode to verify the subscription request.
- The topic represents the feed you want to subscribe.

## Subscribe
As soon as you want to subscribe to a topic you can initiate a subscription request. The subscriber has to verify that action as mentioned above.

```curl
curl -X POST \
  http://localhost:3000/subscribe \
  -H 'cache-control: no-cache' \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d 'hub.topic=http%3A%2F%2Fmyblog.de%2Ffeeds&hub.callback=http%3A%2F%2F127.0.0.1%3A5000&hub.mode=subscribe'
```
## Unsubscribe

As soon as you want to unsubscribe from a topic you can initiate a unsubscription request. The subscriber has to verify that action as mentioned above. 

```curl
curl -X POST \
  http://localhost:3000/unsubscribe \
  -H 'cache-control: no-cache' \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d 'hub.topic=http%3A%2F%2Fmyblog.de%2Ffeeds&hub.callback=http%3A%2F%2F127.0.0.1%3A5000&hub.mode=unsubscribe'
```

## Publish

As soon as you want to notify about updates you can initiate a publishing request which will distribute your content across all subscribers.

```curl
curl -X POST \
  http://localhost:3000/publish \
  -H 'cache-control: no-cache' \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d 'hub.topic=http%3A%2F%2Fmyblog.de%2Ffeeds&hub.mode=publish'
```

## TODO
- Content distribution
  - Reply at failure
  - Content Type
- Discovery

## Test
```
$ npm run test
```
