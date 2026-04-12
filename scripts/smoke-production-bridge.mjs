import { strict as assert } from 'node:assert'
import { EventEmitter } from 'node:events'
import { Readable, Writable } from 'node:stream'

import { handleNodeRequest, loadProductionServerEntry } from './start-production.mjs'

class MockRequest extends Readable {
  constructor({ method = 'GET', url = '/', headers = {} } = {}) {
    super()
    this.method = method
    this.url = url
    this.headers = headers
    this.socket = new EventEmitter()
  }

  _read() {
    this.push(null)
  }
}

class MockResponse extends Writable {
  constructor() {
    super()
    this.statusCode = 200
    this.headers = new Map()
    this.bodyChunks = []
    this.headersSent = false
  }

  setHeader(name, value) {
    this.headers.set(String(name).toLowerCase(), value)
  }

  getHeader(name) {
    return this.headers.get(String(name).toLowerCase())
  }

  _write(chunk, encoding, callback) {
    this.headersSent = true
    this.bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding))
    callback()
  }

  end(chunk, encoding, callback) {
    if (typeof chunk === 'function') {
      return super.end(chunk)
    }

    if (typeof encoding === 'function') {
      callback = encoding
      encoding = undefined
    }

    if (chunk !== undefined) {
      this.headersSent = true
      this.bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding))
    }

    return super.end(callback)
  }

  get bodyText() {
    return Buffer.concat(this.bodyChunks).toString('utf8')
  }
}

const serverEntry = await loadProductionServerEntry()
const request = new MockRequest({
  method: 'GET',
  url: '/',
  headers: {
    host: 'local.test',
  },
})
const response = new MockResponse()

await handleNodeRequest(serverEntry, request, response, { port: 3000 })

assert.ok(response.statusCode >= 200 && response.statusCode < 300, `Expected 2xx but received ${response.statusCode}`)
assert.match(String(response.getHeader('content-type') ?? ''), /text\/html/i)
assert.match(response.bodyText, /AI Inpaint Tool/i)

console.log(
  JSON.stringify(
    {
      ok: true,
      status: response.statusCode,
      contentType: response.getHeader('content-type') ?? null,
      bodyPreview: response.bodyText.slice(0, 120),
    },
    null,
    2,
  ),
)
