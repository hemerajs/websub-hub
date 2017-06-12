'use strict'

function internalError (ctx) {
  return {
    msg: ctx.message,
    code: ctx.code
  }
}

function httpError (ctx) {
  return {
    msg: ctx.msg,
    statusCode: ctx.output.payload.statusCode,
    error: ctx.output.payload.error,
    reason: ctx.output.payload.message
  }
}

module.exports = {
  httpError,
  internalError
}
