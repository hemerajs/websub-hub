<p align="center">
<img src="https://github.com/hemerajs/websub-hub/blob/master/media/logo.png?raw=true" alt="WebSub-Hub" style="max-width:100%;">
</p>

<p align="center">
<a href="https://badge.fury.io/js/websub-hub"><img src="https://camo.githubusercontent.com/48772c29d0514fc99d36e0a0d918c0d8298f9311/68747470733a2f2f62616467652e667572792e696f2f6a732f7765627375622d6875622e737667" alt="npm version" data-canonical-src="https://badge.fury.io/js/websub-hub.svg" style="max-width:100%;"></a>
<a href="https://travis-ci.org/hemerajs/websub-hub"><img src="https://travis-ci.org/hemerajs/websub-hub.svg?branch=master" alt="Build Status" data-canonical-src="https://travis-ci.org/hemerajs/websub-hub.svg?branch=master" style="max-width:100%;"></a>
<a href='https://coveralls.io/github/hemerajs/websub-hub?branch=master'><img src='https://coveralls.io/repos/github/hemerajs/websub-hub/badge.svg?branch=master' alt='Coverage Status' /></a>
<a href="https://standardjs.com"><img src="https://camo.githubusercontent.com/58fbab8bb63d069c1e4fb3fa37c2899c38ffcd18/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f636f64655f7374796c652d7374616e646172642d627269676874677265656e2e737667" alt="npm version" data-canonical-src="https://img.shields.io/badge/code_style-standard-brightgreen.svg" style="max-width:100%;"></a>
<a href="https://camo.githubusercontent.com/9df01034673d657d960eaced20b3c0b3241c2fc7/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f73746162696c6974792d6578706572696d656e74616c2d6f72616e67652e737667" target="_blank"><img src="https://camo.githubusercontent.com/9df01034673d657d960eaced20b3c0b3241c2fc7/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f73746162696c6974792d6578706572696d656e74616c2d6f72616e67652e737667" alt="stability" data-canonical-src="https://img.shields.io/badge/stability-experimental-orange.svg" style="max-width:100%;"></a>
</p>

<p align="center">
A WebSub Hub implementation in <a href="http://nodejs.org/">Node.js</a>
</p>

- **Node:** >= 8.0
- **Lead Maintainer:** [Dustin Deus](https://github.com/StarpTech)
- **Status:** In active development

WebSub provides a common mechanism for communication between publishers of any kind of Web content and their subscribers, based on HTTP web hooks. Subscription requests are relayed through hubs, which validate and verify the request. Hubs then distribute new and updated content to subscribers when it becomes available.

## Expectations

- **Highly performant:** A single node can handle thousands of subscriptions.
- **Scalable:** Scale the hub in minutes. We choose monogdb as distributed storage.
- **Efficient:** The difference (or "delta") may be computed by the hub and sent to all subscribers.
- **Auditing:** Documenting the sequence of activities that have affected system by individual publishers/subscribers.
- **Standardized** We're trying to be full compliant with the W3C WebSub specification.
- **Developer friendly** Provide an easy interface to configure and use the hub.

## Roadmap

- [ ] Discovering the hub and topic URLs by looking at the HTTP headers of the resource URL.
- [ ] Discovering the hub and topic URLs by looking at the contents of the resource URL as an XML document.
- [ ] Discovering the hub and topic URLs by looking at the contents of the resource URL as an HTML document.
- [x] Subscribing to the hub with a callback URL.
- [x] Subscribing to the hub and requesting a specific lease duration.
- [x] Subscribing to the hub with a secret and handling authenticated content distribution.
- [x] Requesting that a subscription is deactivated by sending an unsubscribe request.
- [ ] The Subscriber acknowledges a pending subscription on a validation request.
- [ ] The Subscriber rejects a subscription validation request for an invalid topic URL.
- [ ] The Subscriber returns an HTTP 2xx response when the payload is delivered.
- [ ] The Subscriber verifies the signature for authenticated content distribution requests.
- [ ] The Subscriber rejects the distribution request if the signature does not validate.
- [ ] The Subscriber rejects the distribution request when no signature is present if the subscription was made with a secret.
- [x] The Hub respects the requested lease duration during a subscription request.
- [x] The Hub allows Subscribers to re-request already active subscriptions, extending the lease duration.
- [x] The Hub sends the full contents of the topic URL in the distribution request.
- [ ] The Hub sends a diff of the topic URL for the formats that support it.
- [x] The Hub sends a valid signature for subscriptions that were made with a secret.

### Additional roadmap

- [x] Setup testing environment with CI
- [ ] Auditing
- [ ] Websocket support
- [ ] Benchmarks

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
$ docker run -d -p 27017:27017 -p 28017:28017 -e AUTH=no tutum/mongodb
$ node examples\full-example.js
```

## Test

```
$ npm run test
```
