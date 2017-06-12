#! /usr/bin/env node

'use strict'

const Path = require('path')
const Fs = require('fs')
const Assert = require('assert')
const Minimist = require('minimist')
const Hub = require('websub-hub')

function stop (code) {
  process.exit(code)
}

function start (opts) {
  if (opts.help) {
    console.log(Fs.readFileSync(Path.join(__dirname, 'help.txt'), 'utf8'))
    stop(0)
  }

  runHub(opts)
}

function runHub (opts) {
  var file = null
  try {
    file = require(Path.resolve(process.cwd(), opts.file))
  } catch (e) {}

  const options = {
    requestTimeout: opts.timeout,
    logLevel: opts['log-level'],
    fastify: {
      logger: {
        level: opts['log-level']
      }
    }
  }

  const hub = new Hub(opts.file ? Object.assign(options, file) : options)

  hub.listen(opts.port, opts.address).then(() => {
    console.log(`Server listening on http://localhost:${hub.server.server.address().port}`)
  })
  .catch((err) => {
    Assert.ifError(err)
  })
}

function cli () {
  start(Minimist(process.argv.slice(2), {
    integer: ['port', 'timeout'],
    boolean: ['pretty-logs'],
    string: ['log-level', 'address', 'file'],
    alias: {
      port: 'p',
      help: 'h',
      file: 'f',
      timeout: 't',
      address: 'a',
      'log-level': 'l'
    },
    default: {
      port: 3000,
      address: '127.0.0.1',
      'log-level': 'fatal'
    }
  }))
}

if (require.main === module) {
  cli()
}

module.exports = { start, stop, runHub, cli }
