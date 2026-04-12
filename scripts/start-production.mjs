import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

process.env.NODE_ENV ??= 'production'

const repoRoot = process.cwd()
const builtServerPath = path.join(repoRoot, 'dist/server/server.js')

if (!fs.existsSync(builtServerPath)) {
  console.error('Missing dist/server/server.js. Run `npm run build` before `npm start`.')
  process.exit(1)
}

const { default: serverEntry } = await import(pathToFileURL(builtServerPath).href)

function resolvePort(value) {
  const parsed = Number.parseInt(value ?? '', 10)

  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed
  }

  return 3000
}

function createHeaders(nodeHeaders) {
  const headers = new Headers()

  for (const [name, value] of Object.entries(nodeHeaders)) {
    if (value === undefined) {
      continue
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item)
      }

      continue
    }

    headers.set(name, value)
  }

  return headers
}

function createRequest(req) {
  const headers = createHeaders(req.headers)
  const protocol = headers.get('x-forwarded-proto') ?? 'http'
  const host = headers.get('x-forwarded-host') ?? headers.get('host') ?? `127.0.0.1:${port}`
  const url = new URL(req.url ?? '/', `${protocol}://${host}`)
  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const controller = new AbortController()

  req.on('close', () => controller.abort())

  return new Request(url, {
    method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? 'half' : undefined,
    signal: controller.signal,
  })
}

async function writeResponse(nodeResponse, response) {
  nodeResponse.statusCode = response.status

  const setCookie = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : []

  for (const [name, value] of response.headers) {
    if (name === 'set-cookie') {
      continue
    }

    nodeResponse.setHeader(name, value)
  }

  if (setCookie.length > 0) {
    nodeResponse.setHeader('set-cookie', setCookie)
  }

  if (!response.body) {
    nodeResponse.end()
    return
  }

  Readable.fromWeb(response.body).pipe(nodeResponse)
}

const port = resolvePort(process.env.PORT)
const host = process.env.HOST?.trim() || '0.0.0.0'

const httpServer = createServer(async (req, res) => {
  try {
    const request = createRequest(req)
    const response = await serverEntry.fetch(request)

    await writeResponse(res, response)
  } catch (error) {
    console.error('Failed to handle request.', error)

    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('content-type', 'text/plain; charset=utf-8')
    }

    res.end('Internal Server Error')
  }
})

httpServer.on('error', (error) => {
  console.error(`Failed to start production server on http://${host}:${port}`)
  console.error(error)
  process.exit(1)
})

httpServer.listen(port, host, () => {
  console.log(`Production server listening on http://${host}:${port}`)
})
