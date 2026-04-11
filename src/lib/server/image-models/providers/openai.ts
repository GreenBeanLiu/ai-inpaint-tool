import { getEnv, getMissingEnv, requireEnv } from '@/lib/server/env'
import { ConfigurationError, ExternalServiceError, InputError } from '@/lib/server/errors'
import type {
  ImageEditInput,
  ImageEditProvider,
  ImageEditResult,
} from '@/lib/server/image-models/shared'
import { downloadRemoteImage } from '@/lib/server/image-models/shared'

const requiredOpenAiEnv = ['OPENAI_API_KEY'] as const

const OPENAI_IMAGES_EDIT_API_URL = 'https://api.openai.com/v1/images/edits'
const OPENAI_IMAGE_EDIT_DOCS_URL = 'https://platform.openai.com/docs/guides/image-generation'
const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1.5'

const openAiMaskedEditMimeTypes = ['image/png', 'image/webp'] as const

type OpenAiMaskedEditMimeType = (typeof openAiMaskedEditMimeTypes)[number]

interface OpenAiImageData {
  b64_json?: string
  mime_type?: string
  mimeType?: string
  output_format?: string
  outputFormat?: string
}

function normalizeMimeType(mimeType: string | undefined): string {
  return mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function isSupportedOpenAiMaskedEditMimeType(
  mimeType: string,
): mimeType is OpenAiMaskedEditMimeType {
  return openAiMaskedEditMimeTypes.includes(mimeType as OpenAiMaskedEditMimeType)
}

export function assertOpenAiMaskedEditUploadCompatibility(
  sourceMimeType: string,
  maskMimeType: string,
) {
  const normalizedSourceMimeType = normalizeMimeType(sourceMimeType)
  const normalizedMaskMimeType = normalizeMimeType(maskMimeType)

  if (normalizedSourceMimeType !== normalizedMaskMimeType) {
    throw new InputError('OpenAI masked image edits require the source image and mask to use the same MIME type', {
      provider: 'openai',
      sourceMimeType: normalizedSourceMimeType || null,
      maskMimeType: normalizedMaskMimeType || null,
      supportedMimeTypes: openAiMaskedEditMimeTypes,
      docsUrl: OPENAI_IMAGE_EDIT_DOCS_URL,
    })
  }

  if (!isSupportedOpenAiMaskedEditMimeType(normalizedSourceMimeType)) {
    throw new InputError('OpenAI masked image edits currently require PNG or WEBP uploads in this worker', {
      provider: 'openai',
      sourceMimeType: normalizedSourceMimeType || null,
      maskMimeType: normalizedMaskMimeType || null,
      supportedMimeTypes: openAiMaskedEditMimeTypes,
      docsUrl: OPENAI_IMAGE_EDIT_DOCS_URL,
      note: 'JPEG is rejected here because the mask must carry transparency and this worker does not transcode uploads before calling the OpenAI Images API.',
    })
  }
}

function getOpenAiConfig(preferredModel: string | undefined) {
  const missingEnv = getMissingEnv(requiredOpenAiEnv)

  if (missingEnv.length > 0) {
    throw new ConfigurationError('OpenAI image editing integration is not configured', {
      missingEnv,
    })
  }

  return {
    apiKey: requireEnv('OPENAI_API_KEY'),
    model: preferredModel?.trim() || getEnv('OPENAI_IMAGE_MODEL') || DEFAULT_OPENAI_IMAGE_MODEL,
  }
}

function parseOpenAiResponseBody(responseText: string): unknown {
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

function inferMimeTypeFromOpenAiResponse(data: OpenAiImageData): string {
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

function getOpenAiImageData(responseBody: unknown): OpenAiImageData {
  if (!responseBody || typeof responseBody !== 'object') {
    throw new ExternalServiceError('OpenAI image edit response body was not valid JSON', {
      provider: 'openai',
      operation: 'masked-image-edit',
      responseBody,
    })
  }

  const data = Reflect.get(responseBody, 'data')

  if (!Array.isArray(data) || data.length === 0 || !data[0] || typeof data[0] !== 'object') {
    throw new ExternalServiceError('OpenAI image edit response did not include image data', {
      provider: 'openai',
      operation: 'masked-image-edit',
      responseBody,
    })
  }

  return data[0] as OpenAiImageData
}

function toFile(bytes: Uint8Array, mimeType: string, basename: 'source' | 'mask'): File {
  const extension =
    mimeType === 'image/png'
      ? 'png'
      : mimeType === 'image/webp'
        ? 'webp'
        : mimeType === 'image/jpeg'
          ? 'jpg'
          : 'bin'

  return new File([Buffer.from(bytes)], `${basename}.${extension}`, { type: mimeType })
}

export class OpenAiImageEditProvider implements ImageEditProvider {
  readonly id = 'openai'
  readonly displayName = 'OpenAI Images'

  supportsMaskInpainting(): boolean {
    return true
  }

  async editImage(input: ImageEditInput): Promise<ImageEditResult> {
    const config = getOpenAiConfig(input.model)
    const [sourceImage, maskImage] = await Promise.all([
      downloadRemoteImage(input.sourceImageUrl, {
        provider: 'openai',
        operation: 'masked-image-edit',
        asset: 'source',
      }),
      downloadRemoteImage(input.maskImageUrl, {
        provider: 'openai',
        operation: 'masked-image-edit',
        asset: 'mask',
      }),
    ])

    assertOpenAiMaskedEditUploadCompatibility(sourceImage.mimeType, maskImage.mimeType)

    const prompt =
      input.prompt?.trim() ||
      'Edit the image according to the mask and return only the final edited image.'

    const formData = new FormData()
    formData.append('model', config.model)
    formData.append('prompt', prompt)
    formData.append('image[]', toFile(sourceImage.bytes, sourceImage.mimeType, 'source'))
    formData.append('mask', toFile(maskImage.bytes, maskImage.mimeType, 'mask'))

    const response = await fetch(OPENAI_IMAGES_EDIT_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: formData,
    })

    const responseText = await response.text()
    const responseBody = parseOpenAiResponseBody(responseText)

    if (!response.ok) {
      throw new ExternalServiceError('OpenAI image edit request failed', {
        provider: 'openai',
        operation: 'masked-image-edit',
        model: config.model,
        status: response.status,
        statusText: response.statusText,
        responseBody,
        docsUrl: OPENAI_IMAGE_EDIT_DOCS_URL,
      }, response.status)
    }

    const imageData = getOpenAiImageData(responseBody)

    if (typeof imageData.b64_json !== 'string' || imageData.b64_json.length === 0) {
      throw new ExternalServiceError('OpenAI image edit response did not include base64 image bytes', {
        provider: 'openai',
        operation: 'masked-image-edit',
        model: config.model,
        responseBody,
      })
    }

    return {
      resultImageBytes: Buffer.from(imageData.b64_json, 'base64'),
      resultMimeType: inferMimeTypeFromOpenAiResponse(imageData),
      providerRequestId: response.headers.get('x-request-id') ?? undefined,
    }
  }
}

export function createOpenAiImageEditProvider() {
  return new OpenAiImageEditProvider()
}
