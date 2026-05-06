import { getEnv, getMissingEnv, requireEnv } from '@/lib/server/env'
import { ConfigurationError, ExternalServiceError, InputError } from '@/lib/server/errors'
import { DEFAULT_TIKHUB_IMAGE_MODEL } from '@/lib/server/image-models/defaults'
import type {
  ImageEditInput,
  ImageEditProvider,
  ImageEditResult,
  MaskedEditUploadCompatibilityInput,
} from '@/lib/server/image-models/shared'
import {
  downloadRemoteImage,
  imageMimeTypeToExtension,
  normalizeMimeType,
  parseJsonResponseBody,
} from '@/lib/server/image-models/shared'

const requiredTikhubEnv = ['TIKHUB_API_KEY'] as const

const DEFAULT_TIKHUB_API_BASE_URL = 'https://ai.tikhub.io/v1'
const DEFAULT_TIKHUB_IMAGE_EDIT_PATH = '/images/edits'
const TIKHUB_IMAGE_EDIT_DOCS_URL = 'https://ai.tikhub.io/'

const tikhubMaskedEditMimeTypes = ['image/png', 'image/webp'] as const

type TikhubMaskedEditMimeType = (typeof tikhubMaskedEditMimeTypes)[number]

interface TikhubImageData {
  b64_json?: string
  b64Json?: string
  url?: string
  mime_type?: string
  mimeType?: string
  output_format?: string
  outputFormat?: string
}

function isSupportedTikhubMaskedEditMimeType(
  mimeType: string,
): mimeType is TikhubMaskedEditMimeType {
  return tikhubMaskedEditMimeTypes.includes(mimeType as TikhubMaskedEditMimeType)
}

export function assertTikhubMaskedEditUploadCompatibility(
  input: MaskedEditUploadCompatibilityInput,
) {
  const normalizedSourceMimeType = normalizeMimeType(input.sourceMimeType)
  const normalizedMaskMimeType = normalizeMimeType(input.maskMimeType)

  if (normalizedSourceMimeType !== normalizedMaskMimeType) {
    throw new InputError('Tikhub masked image edits require the source image and mask to use the same MIME type', {
      provider: 'tikhub',
      sourceMimeType: normalizedSourceMimeType || null,
      maskMimeType: normalizedMaskMimeType || null,
      supportedMimeTypes: tikhubMaskedEditMimeTypes,
      docsUrl: TIKHUB_IMAGE_EDIT_DOCS_URL,
    })
  }

  if (!isSupportedTikhubMaskedEditMimeType(normalizedSourceMimeType)) {
    throw new InputError('Tikhub masked image edits currently require PNG or WEBP uploads in this worker', {
      provider: 'tikhub',
      sourceMimeType: normalizedSourceMimeType || null,
      maskMimeType: normalizedMaskMimeType || null,
      supportedMimeTypes: tikhubMaskedEditMimeTypes,
      docsUrl: TIKHUB_IMAGE_EDIT_DOCS_URL,
      note: 'JPEG is rejected here because the mask must carry transparency and this server path does not transcode uploads before calling the Tikhub OpenAI-compatible Images API. The default homepage flow normalizes JPEG and WEBP source images to PNG before upload.',
    })
  }
}

function buildApiUrl(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\/+/, ''), `${baseUrl.replace(/\/+$/, '')}/`).toString()
}

function getTikhubConfig(preferredModel: string | undefined) {
  const missingEnv = getMissingEnv(requiredTikhubEnv)

  if (missingEnv.length > 0) {
    throw new ConfigurationError('Tikhub image editing integration is not configured', {
      missingEnv,
    })
  }

  const baseUrl = getEnv('TIKHUB_API_BASE_URL') || DEFAULT_TIKHUB_API_BASE_URL
  const editPath = getEnv('TIKHUB_IMAGE_EDIT_PATH') || DEFAULT_TIKHUB_IMAGE_EDIT_PATH

  return {
    apiKey: requireEnv('TIKHUB_API_KEY'),
    model: preferredModel?.trim() || getEnv('TIKHUB_IMAGE_MODEL') || DEFAULT_TIKHUB_IMAGE_MODEL,
    imageEditUrl: buildApiUrl(baseUrl, editPath),
  }
}

function inferMimeTypeFromTikhubResponse(data: TikhubImageData): string {
  const mimeType = normalizeMimeType(data.mime_type ?? data.mimeType)

  if (mimeType) {
    return mimeType
  }

  const outputFormat = (data.output_format ?? data.outputFormat)?.trim().toLowerCase()

  if (outputFormat === 'jpeg' || outputFormat === 'jpg') {
    return 'image/jpeg'
  }

  if (outputFormat === 'webp') {
    return 'image/webp'
  }

  return 'image/png'
}

function getTikhubImageData(responseBody: unknown): TikhubImageData {
  if (!responseBody || typeof responseBody !== 'object') {
    throw new ExternalServiceError('Tikhub image edit response body was not valid JSON', {
      provider: 'tikhub',
      operation: 'masked-image-edit',
      responseBody,
    })
  }

  const data = Reflect.get(responseBody, 'data')

  if (!Array.isArray(data) || data.length === 0 || !data[0] || typeof data[0] !== 'object') {
    throw new ExternalServiceError('Tikhub image edit response did not include image data', {
      provider: 'tikhub',
      operation: 'masked-image-edit',
      responseBody,
    })
  }

  return data[0] as TikhubImageData
}

function toFile(bytes: Uint8Array, mimeType: string, basename: 'source' | 'mask'): File {
  return new File([Buffer.from(bytes)], `${basename}.${imageMimeTypeToExtension(mimeType)}`, {
    type: mimeType,
  })
}

function inferMimeTypeFromUrl(url: string): string {
  const normalizedUrl = url.trim().toLowerCase()

  if (normalizedUrl.includes('.webp')) {
    return 'image/webp'
  }

  if (normalizedUrl.includes('.jpg') || normalizedUrl.includes('.jpeg')) {
    return 'image/jpeg'
  }

  return 'image/png'
}

async function downloadResultImage(url: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const response = await fetch(url)

  if (!response.ok) {
    const responseText = (await response.text()).trim()

    throw new ExternalServiceError('Tikhub generated image URL could not be downloaded', {
      provider: 'tikhub',
      operation: 'masked-image-edit',
      resultUrl: url,
      status: response.status,
      statusText: response.statusText,
      responseBody: responseText ? responseText.slice(0, 1000) : null,
    }, response.status)
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType:
      normalizeMimeType(response.headers.get('content-type') ?? undefined) ||
      inferMimeTypeFromUrl(url),
  }
}

export class TikhubImageEditProvider implements ImageEditProvider {
  readonly id = 'tikhub'
  readonly displayName = 'Tikhub Images'

  supportsMaskInpainting(): boolean {
    return true
  }

  assertMaskedEditUploadCompatibility(input: MaskedEditUploadCompatibilityInput): void {
    assertTikhubMaskedEditUploadCompatibility(input)
  }

  async editImage(input: ImageEditInput): Promise<ImageEditResult> {
    const config = getTikhubConfig(input.model)
    const [sourceImage, maskImage] = await Promise.all([
      downloadRemoteImage(input.sourceImageUrl, {
        provider: 'tikhub',
        operation: 'masked-image-edit',
        asset: 'source',
      }),
      downloadRemoteImage(input.maskImageUrl, {
        provider: 'tikhub',
        operation: 'masked-image-edit',
        asset: 'mask',
      }),
    ])

    assertTikhubMaskedEditUploadCompatibility({
      sourceMimeType: sourceImage.mimeType,
      maskMimeType: maskImage.mimeType,
    })

    const prompt =
      input.prompt?.trim() ||
      'Edit the image according to the mask and return only the final edited image.'

    const formData = new FormData()
    formData.append('model', config.model)
    formData.append('prompt', prompt)
    formData.append('n', '1')
    formData.append('image[]', toFile(sourceImage.bytes, sourceImage.mimeType, 'source'))
    formData.append('mask', toFile(maskImage.bytes, maskImage.mimeType, 'mask'))

    const response = await fetch(config.imageEditUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: formData,
    })

    const responseText = await response.text()
    const responseBody = parseJsonResponseBody(responseText)

    if (!response.ok) {
      throw new ExternalServiceError('Tikhub image edit request failed', {
        provider: 'tikhub',
        operation: 'masked-image-edit',
        model: config.model,
        status: response.status,
        statusText: response.statusText,
        responseBody,
        docsUrl: TIKHUB_IMAGE_EDIT_DOCS_URL,
        imageEditUrl: config.imageEditUrl,
      }, response.status)
    }

    const imageData = getTikhubImageData(responseBody)

    if (typeof imageData.b64_json === 'string' && imageData.b64_json.length > 0) {
      return {
        resultImageBytes: Buffer.from(imageData.b64_json, 'base64'),
        resultMimeType: inferMimeTypeFromTikhubResponse(imageData),
        providerRequestId: response.headers.get('x-request-id') ?? undefined,
      }
    }

    if (typeof imageData.b64Json === 'string' && imageData.b64Json.length > 0) {
      return {
        resultImageBytes: Buffer.from(imageData.b64Json, 'base64'),
        resultMimeType: inferMimeTypeFromTikhubResponse(imageData),
        providerRequestId: response.headers.get('x-request-id') ?? undefined,
      }
    }

    if (typeof imageData.url === 'string' && imageData.url.length > 0) {
      const downloaded = await downloadResultImage(imageData.url)

      return {
        resultImageBytes: downloaded.bytes,
        resultMimeType: downloaded.mimeType,
        providerRequestId: response.headers.get('x-request-id') ?? undefined,
      }
    }

    throw new ExternalServiceError('Tikhub image edit response did not include base64 bytes or a result URL', {
      provider: 'tikhub',
      operation: 'masked-image-edit',
      model: config.model,
      responseBody,
    })
  }
}

export function createTikhubImageEditProvider() {
  return new TikhubImageEditProvider()
}
