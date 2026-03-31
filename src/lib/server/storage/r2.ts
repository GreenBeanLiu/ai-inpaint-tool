import { createHash, createHmac } from 'node:crypto'

import { getMissingEnv, requireEnv } from '@/lib/server/env'
import { ConfigurationError, ExternalServiceError } from '@/lib/server/errors'

export interface UploadAssetInput {
  key: string
  body: ArrayBuffer | Uint8Array
  contentType: string
}

export interface UploadAssetResult {
  key: string
  url: string
}

export interface DownloadAssetResult {
  key: string
  body: Uint8Array
  contentType: string | null
  contentLength: number | null
  etag: string | null
}

const requiredR2Env = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_BASE_URL',
] as const

interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
  publicBaseUrl: string
  endpoint: string
  host: string
}

function assertR2Configured() {
  const missingEnv = getMissingEnv(requiredR2Env)

  if (missingEnv.length > 0) {
    throw new ConfigurationError('Cloudflare R2 integration is not configured', {
      missingEnv,
    })
  }
}

function getR2Config(): R2Config {
  assertR2Configured()

  const accountId = requireEnv('R2_ACCOUNT_ID')

  return {
    accountId,
    accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
    bucketName: requireEnv('R2_BUCKET_NAME'),
    publicBaseUrl: requireEnv('R2_PUBLIC_BASE_URL').replace(/\/+$/, ''),
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    host: `${accountId}.r2.cloudflarestorage.com`,
  }
}

function normalizeKey(key: string): string {
  return key.replace(/^\/+/, '')
}

function encodeR2Key(key: string): string {
  return normalizeKey(key)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function toUint8Array(body: ArrayBuffer | Uint8Array): Uint8Array {
  return body instanceof Uint8Array ? body : new Uint8Array(body)
}

function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: Uint8Array | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

function getSignatureKey(secretAccessKey: string, dateStamp: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp)
  const kRegion = hmac(kDate, 'auto')
  const kService = hmac(kRegion, 's3')
  return hmac(kService, 'aws4_request')
}

function toAmzDate(date: Date) {
  const iso = date.toISOString()
  return {
    amzDate: iso.replace(/[:-]|\.\d{3}/g, ''),
    dateStamp: iso.slice(0, 10).replace(/-/g, ''),
  }
}

function createSignedR2Request(input: {
  method: 'GET' | 'PUT'
  key: string
  body?: Uint8Array
  contentType?: string
}) {
  const config = getR2Config()
  const encodedKey = encodeR2Key(input.key)
  const canonicalUri = `/${config.bucketName}/${encodedKey}`
  const url = `${config.endpoint}${canonicalUri}`
  const now = new Date()
  const { amzDate, dateStamp } = toAmzDate(now)
  const body = input.body ?? new Uint8Array()
  const payloadHash = sha256Hex(body)

  const canonicalHeadersList = [
    ['host', config.host],
    ['x-amz-content-sha256', payloadHash],
    ['x-amz-date', amzDate],
  ]

  if (input.contentType) {
    canonicalHeadersList.push(['content-type', input.contentType])
  }

  canonicalHeadersList.sort(([left], [right]) => left.localeCompare(right))

  const canonicalHeaders = canonicalHeadersList
    .map(([name, value]) => `${name}:${value.trim()}\n`)
    .join('')
  const signedHeaders = canonicalHeadersList.map(([name]) => name).join(';')
  const canonicalRequest = [
    input.method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')
  const signature = createHmac(
    'sha256',
    getSignatureKey(config.secretAccessKey, dateStamp),
  )
    .update(stringToSign)
    .digest('hex')

  const headers = new Headers({
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: [
      `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', '),
  })

  if (input.contentType) {
    headers.set('content-type', input.contentType)
  }

  return { url, headers, body, key: normalizeKey(input.key) }
}

async function parseR2Failure(response: Response): Promise<never> {
  const responseText = (await response.text()).trim()

  throw new ExternalServiceError('Cloudflare R2 request failed', {
    service: 'cloudflare-r2',
    status: response.status,
    statusText: response.statusText,
    responseBody: responseText ? responseText.slice(0, 1000) : null,
  })
}

export async function uploadAssetToR2(input: UploadAssetInput): Promise<UploadAssetResult> {
  const body = toUint8Array(input.body)
  const signedRequest = createSignedR2Request({
    method: 'PUT',
    key: input.key,
    body,
    contentType: input.contentType,
  })

  const response = await fetch(signedRequest.url, {
    method: 'PUT',
    headers: signedRequest.headers,
    body: Buffer.from(body),
  })

  if (!response.ok) {
    await parseR2Failure(response)
  }

  return {
    key: signedRequest.key,
    url: buildR2ObjectUrl(signedRequest.key),
  }
}

export async function downloadAssetFromR2(key: string): Promise<DownloadAssetResult> {
  const signedRequest = createSignedR2Request({
    method: 'GET',
    key,
  })
  const response = await fetch(signedRequest.url, {
    method: 'GET',
    headers: signedRequest.headers,
  })

  if (!response.ok) {
    await parseR2Failure(response)
  }

  return {
    key: signedRequest.key,
    body: new Uint8Array(await response.arrayBuffer()),
    contentType: response.headers.get('content-type'),
    contentLength: Number.parseInt(response.headers.get('content-length') ?? '', 10) || null,
    etag: response.headers.get('etag'),
  }
}

export function buildR2ObjectUrl(key: string): string {
  const { publicBaseUrl } = getR2Config()
  return `${publicBaseUrl}/${encodeR2Key(key)}`
}
