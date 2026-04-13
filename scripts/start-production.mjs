import fs from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { H3, fromWebHandler, toNodeHandler } from 'h3-v2/node'

process.env.NODE_ENV ??= 'production'

const repoRoot = process.cwd()
const builtServerPath = path.join(repoRoot, 'dist/server/server.js')

export function ensureBuiltServerExists(serverPath = builtServerPath) {
  if (!fs.existsSync(serverPath)) {
    console.error('Missing dist/server/server.js. Run `npm run build` before `npm start`.')
    process.exit(1)
  }
}

function isServerEntry(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.fetch === 'function'
}

function describeShape(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return String(value)
  }

  const keys = Object.keys(value)

  if (keys.length === 0) {
    return '(no enumerable keys)'
  }

  return keys.map((key) => `${key}:${typeof value[key]}`).join(', ')
}

export function resolveServerEntry(moduleExports) {
  const directCandidates = [
    moduleExports?.default,
    moduleExports?.default?.default,
    moduleExports,
  ]

  for (const candidate of directCandidates) {
    if (isServerEntry(candidate)) {
      return candidate
    }
  }

  const createServerEntry =
    typeof moduleExports?.createServerEntry === 'function'
      ? moduleExports.createServerEntry
      : null
  const fetchCandidates = [
    moduleExports?.fetch,
    moduleExports?.default,
    moduleExports?.default?.fetch,
    moduleExports?.default?.default,
  ]

  if (createServerEntry) {
    for (const fetchCandidate of fetchCandidates) {
      if (typeof fetchCandidate !== 'function') {
        continue
      }

      const candidate = createServerEntry({ fetch: fetchCandidate })

      if (isServerEntry(candidate)) {
        return candidate
      }
    }
  }

  const exportKeys = Object.keys(moduleExports ?? {})

  throw new TypeError(
    [
      'Unsupported dist/server/server.js runtime shape.',
      `module exports: ${exportKeys.length > 0 ? exportKeys.join(', ') : '(none)'}`,
      `default shape: ${describeShape(moduleExports?.default)}`,
    ].join(' '),
  )
}

export async function loadProductionServerEntry(serverPath = builtServerPath) {
  ensureBuiltServerExists(serverPath)

  const moduleExports = await import(pathToFileURL(serverPath).href)
  return resolveServerEntry(moduleExports)
}

export function resolvePort(value) {
  const parsed = Number.parseInt(value ?? '', 10)

  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed
  }

  return 3000
}

export function createProductionRequestHandler(serverEntry) {
  const app = new H3()
  const webHandler = fromWebHandler((request) => serverEntry.fetch(request))

  app.all('/', webHandler)
  app.all('/**', webHandler)

  return toNodeHandler(app)
}

export async function handleNodeRequest(serverEntry, nodeRequest, nodeResponse) {
  const handler = createProductionRequestHandler(serverEntry)
  await handler(nodeRequest, nodeResponse)
}

export function createProductionServer(serverEntry, { port }) {
  const handler = createProductionRequestHandler(serverEntry)

  return createServer(async (req, res) => {
    try {
      await handler(req, res)
    } catch (error) {
      console.error('Failed to handle request.', error)

      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('content-type', 'text/plain; charset=utf-8')
      }

      res.end('Internal Server Error')
    }
  })
}

export async function startProductionServer({
  host = process.env.HOST?.trim() || '0.0.0.0',
  port = resolvePort(process.env.PORT),
} = {}) {
  const serverEntry = await loadProductionServerEntry()
  const httpServer = createProductionServer(serverEntry, { port })

  httpServer.on('error', (error) => {
    console.error(`Failed to start production server on http://${host}:${port}`)
    console.error(error)
    process.exit(1)
  })

  httpServer.listen(port, host, () => {
    console.log(`Production server listening on http://${host}:${port}`)
  })

  return httpServer
}

const isMainModule =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMainModule) {
  await startProductionServer()
}
