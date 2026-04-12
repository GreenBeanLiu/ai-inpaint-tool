import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = process.cwd()
const builtServerPath = path.join(repoRoot, 'dist/server/server.js')

if (!fs.existsSync(builtServerPath)) {
  console.error('Missing dist/server/server.js. Run `npm run build` before `npm run verify:runtime`.')
  process.exit(1)
}

const { default: server } = await import(pathToFileURL(builtServerPath).href)

function createUrl(pathname) {
  return new URL(pathname, 'http://local.test')
}

async function request(pathname, init) {
  const response = await server.fetch(new Request(createUrl(pathname), init))
  const bodyText = await response.text()
  let bodyJson = null

  try {
    bodyJson = JSON.parse(bodyText)
  } catch {}

  return {
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type'),
    bodyText,
    bodyJson,
  }
}

function createTinyPngFile(name) {
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==',
    'base64',
  )

  return new File([bytes], `${name}.png`, { type: 'image/png' })
}

const startup = await request('/')
const runtimeCheck = await request('/api/runtime-check')
const listJobs = await request('/api/edit-jobs')

let createJob = {
  attempted: false,
  ok: false,
  status: null,
  blocker: null,
  response: null,
}

const runtimeReport = runtimeCheck.bodyJson

if (startup.ok && runtimeReport?.overall?.canCreateJob) {
  const formData = new FormData()
  formData.append('image', createTinyPngFile('source'))
  formData.append('mask', createTinyPngFile('mask'))
  formData.append('prompt', 'Replace the pixel')

  const response = await request('/api/edit-jobs', {
    method: 'POST',
    body: formData,
  })

  createJob = {
    attempted: true,
    ok: response.ok,
    status: response.status,
    blocker: response.ok
      ? null
      : (response.bodyJson?.error?.message || response.bodyText.slice(0, 300) || null),
    response: response.bodyJson || response.bodyText.slice(0, 500) || null,
  }
} else if (startup.ok) {
  createJob = {
    attempted: false,
    ok: false,
    status: null,
    blocker:
      runtimeReport?.overall?.blockers?.[0] ??
      'Runtime preflight did not confirm that job creation is possible.',
    response: runtimeReport?.overall ?? null,
  }
} else {
  createJob = {
    attempted: false,
    ok: false,
    status: null,
    blocker: 'Startup request failed before job creation could be attempted.',
    response: runtimeReport?.overall ?? null,
  }
}

const summary = {
  startup: {
    ok: startup.ok,
    status: startup.status,
    contentType: startup.contentType,
  },
  runtimeCheck: runtimeReport ?? {
    ok: runtimeCheck.ok,
    status: runtimeCheck.status,
    response: runtimeCheck.bodyJson ?? runtimeCheck.bodyText.slice(0, 500),
  },
  listJobs: listJobs.ok
    ? {
        ok: true,
        status: listJobs.status,
      }
    : {
        ok: false,
        status: listJobs.status,
        blocker: listJobs.bodyJson?.error?.message ?? listJobs.bodyText.slice(0, 300),
      },
  createJob,
}

console.log(JSON.stringify(summary, null, 2))

process.exit(startup.ok && runtimeCheck.ok && createJob.ok ? 0 : 1)
