import { ExternalServiceError } from '@/lib/server/errors'

export interface ImageEditInput {
  sourceImageUrl: string
  maskImageUrl: string
  prompt?: string
  model?: string
  mimeType?: string
}

export interface MaskedEditUploadCompatibilityInput {
  sourceMimeType: string
  maskMimeType: string
}

export interface ImageEditResult {
  resultImageBytes: Uint8Array
  resultMimeType: string
  providerRequestId?: string
}

export interface ImageEditProvider {
  readonly id: string
  readonly displayName: string
  supportsMaskInpainting(): boolean
  assertMaskedEditUploadCompatibility(input: MaskedEditUploadCompatibilityInput): void
  editImage(input: ImageEditInput): Promise<ImageEditResult>
}

export interface DownloadedImage {
  bytes: Uint8Array
  mimeType: string
}

export function normalizeMimeType(mimeType: string | undefined): string {
  return mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

export function imageMimeTypeToExtension(mimeType: string): string {
  if (mimeType === 'image/png') {
    return 'png'
  }

  if (mimeType === 'image/webp') {
    return 'webp'
  }

  if (mimeType === 'image/jpeg') {
    return 'jpg'
  }

  return 'bin'
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

export function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${toBase64(bytes)}`
}

export function parseJsonResponseBody(responseText: string): unknown {
  if (!responseText) {
    return null
  }

  try {
    return JSON.parse(responseText) as unknown
  } catch {
    return {
      rawText: responseText.slice(0, 2000),
    }
  }
}

export async function downloadRemoteImage(
  url: string,
  params: {
    provider: string
    operation: string
    asset: 'source' | 'mask'
  },
): Promise<DownloadedImage> {
  const response = await fetch(url)

  if (!response.ok) {
    const responseText = (await response.text()).trim()

    throw new ExternalServiceError(`Failed to download ${params.asset} image for ${params.provider}`, {
      provider: params.provider,
      operation: params.operation,
      asset: params.asset,
      sourceUrl: url,
      status: response.status,
      statusText: response.statusText,
      responseBody: responseText ? responseText.slice(0, 1000) : null,
    })
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType: response.headers.get('content-type') ?? 'application/octet-stream',
  }
}
