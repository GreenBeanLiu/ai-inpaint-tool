import { ExternalServiceError } from '@/lib/server/errors'

export interface ImageEditInput {
  sourceImageUrl: string
  maskImageUrl: string
  prompt?: string
  mimeType?: string
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
  editImage(input: ImageEditInput): Promise<ImageEditResult>
}

export interface DownloadedImage {
  bytes: Uint8Array
  mimeType: string
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
