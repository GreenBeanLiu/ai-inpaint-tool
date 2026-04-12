import { getEnv, getMissingEnv, requireEnv } from '@/lib/server/env'
import { ConfigurationError, ExternalServiceError, InputError } from '@/lib/server/errors'
import { DEFAULT_OPENROUTER_IMAGE_MODEL } from '@/lib/server/image-models/defaults'
import type {
  ImageEditInput,
  ImageEditProvider,
  ImageEditResult,
  MaskedEditUploadCompatibilityInput,
} from '@/lib/server/image-models/shared'
import {
  downloadRemoteImage,
  normalizeMimeType,
  parseJsonResponseBody,
  toDataUrl,
} from '@/lib/server/image-models/shared'

const requiredOpenRouterEnv = ['OPENROUTER_API_KEY'] as const

const OPENROUTER_CHAT_COMPLETIONS_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_IMAGE_GENERATION_DOCS_URL =
  'https://openrouter.ai/docs/guides/overview/multimodal/image-generation'
const OPENROUTER_IMAGE_INPUT_DOCS_URL =
  'https://openrouter.ai/docs/guides/overview/multimodal/images'

const openRouterSourceMimeTypes = ['image/png', 'image/jpeg', 'image/webp'] as const
const openRouterMaskMimeTypes = ['image/png', 'image/webp'] as const

type OpenRouterSourceMimeType = (typeof openRouterSourceMimeTypes)[number]
type OpenRouterMaskMimeType = (typeof openRouterMaskMimeTypes)[number]

interface OpenRouterResponseBody {
  id?: string
  choices?: Array<{
    message?: {
      images?: Array<{
        image_url?: {
          url?: string
        }
        imageUrl?: {
          url?: string
        }
      }>
    }
  }>
}

function isSupportedOpenRouterSourceMimeType(
  mimeType: string,
): mimeType is OpenRouterSourceMimeType {
  return openRouterSourceMimeTypes.includes(mimeType as OpenRouterSourceMimeType)
}

function isSupportedOpenRouterMaskMimeType(
  mimeType: string,
): mimeType is OpenRouterMaskMimeType {
  return openRouterMaskMimeTypes.includes(mimeType as OpenRouterMaskMimeType)
}

export function assertOpenRouterMaskedEditUploadCompatibility(
  input: MaskedEditUploadCompatibilityInput,
) {
  const normalizedSourceMimeType = normalizeMimeType(input.sourceMimeType)
  const normalizedMaskMimeType = normalizeMimeType(input.maskMimeType)

  if (!isSupportedOpenRouterSourceMimeType(normalizedSourceMimeType)) {
    throw new InputError('OpenRouter masked edits in this worker require a PNG, JPEG, or WEBP source image', {
      provider: 'openrouter',
      sourceMimeType: normalizedSourceMimeType || null,
      maskMimeType: normalizedMaskMimeType || null,
      supportedSourceMimeTypes: openRouterSourceMimeTypes,
      docsUrl: OPENROUTER_IMAGE_INPUT_DOCS_URL,
    })
  }

  if (!isSupportedOpenRouterMaskMimeType(normalizedMaskMimeType)) {
    throw new InputError('OpenRouter masked edits in this worker require the mask image to be PNG or WEBP', {
      provider: 'openrouter',
      sourceMimeType: normalizedSourceMimeType || null,
      maskMimeType: normalizedMaskMimeType || null,
      supportedMaskMimeTypes: openRouterMaskMimeTypes,
      docsUrl: OPENROUTER_IMAGE_INPUT_DOCS_URL,
      note: 'This adapter sends the source image and the mask image as multimodal chat inputs because OpenRouter does not expose a separate binary mask field on this path. The mask must preserve transparency or clear painted regions, so JPEG masks are rejected.',
    })
  }
}

function getOpenRouterConfig(preferredModel: string | undefined) {
  const missingEnv = getMissingEnv(requiredOpenRouterEnv)

  if (missingEnv.length > 0) {
    throw new ConfigurationError('OpenRouter image editing integration is not configured', {
      missingEnv,
    })
  }

  return {
    apiKey: requireEnv('OPENROUTER_API_KEY'),
    model:
      preferredModel?.trim() ||
      getEnv('OPENROUTER_IMAGE_MODEL') ||
      DEFAULT_OPENROUTER_IMAGE_MODEL,
  }
}

function buildOpenRouterPrompt(prompt: string | undefined): string {
  const requestedEdit =
    prompt?.trim() || 'Edit the source image according to the supplied mask.'

  return [
    requestedEdit,
    'Treat the first image as the source image.',
    'Treat the second image as the mask image.',
    'Treat transparent or clearly marked regions of the mask as editable, and preserve all unmasked content.',
    'Return only the final edited image.',
  ].join('\n')
}

function extractFirstImageDataUrl(responseBody: unknown): { dataUrl: string; requestId?: string } {
  if (!responseBody || typeof responseBody !== 'object') {
    throw new ExternalServiceError('OpenRouter image edit response body was not valid JSON', {
      provider: 'openrouter',
      operation: 'masked-image-edit',
      responseBody,
    })
  }

  const body = responseBody as OpenRouterResponseBody
  const firstImageUrl =
    body.choices?.[0]?.message?.images?.[0]?.image_url?.url ??
    body.choices?.[0]?.message?.images?.[0]?.imageUrl?.url

  if (typeof firstImageUrl !== 'string' || firstImageUrl.length === 0) {
    throw new ExternalServiceError('OpenRouter image edit response did not include an image data URL', {
      provider: 'openrouter',
      operation: 'masked-image-edit',
      responseBody,
      docsUrl: OPENROUTER_IMAGE_GENERATION_DOCS_URL,
    })
  }

  return {
    dataUrl: firstImageUrl,
    requestId: body.id,
  }
}

async function resolveOpenRouterResponseImage(
  imageUrl: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (/^https?:\/\//i.test(imageUrl)) {
    const response = await fetch(imageUrl)

    if (!response.ok) {
      throw new ExternalServiceError('OpenRouter returned a result image URL that could not be downloaded', {
        provider: 'openrouter',
        operation: 'masked-image-edit',
        status: response.status,
        statusText: response.statusText,
        imageUrl,
        docsUrl: OPENROUTER_IMAGE_GENERATION_DOCS_URL,
      })
    }

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mimeType: normalizeMimeType(response.headers.get('content-type') ?? undefined) || 'image/png',
    }
  }

  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(imageUrl)

  if (!match) {
    throw new ExternalServiceError('OpenRouter image edit response returned an unsupported image URL format', {
      provider: 'openrouter',
      operation: 'masked-image-edit',
      imageUrlPreview: imageUrl.slice(0, 200),
      docsUrl: OPENROUTER_IMAGE_GENERATION_DOCS_URL,
    })
  }

  return {
    mimeType: normalizeMimeType(match[1]) || 'image/png',
    bytes: Buffer.from(match[2], 'base64'),
  }
}

export class OpenRouterImageEditProvider implements ImageEditProvider {
  readonly id = 'openrouter'
  readonly displayName = 'OpenRouter Images'

  supportsMaskInpainting(): boolean {
    return true
  }

  assertMaskedEditUploadCompatibility(input: MaskedEditUploadCompatibilityInput): void {
    assertOpenRouterMaskedEditUploadCompatibility(input)
  }

  async editImage(input: ImageEditInput): Promise<ImageEditResult> {
    const config = getOpenRouterConfig(input.model)
    const [sourceImage, maskImage] = await Promise.all([
      downloadRemoteImage(input.sourceImageUrl, {
        provider: 'openrouter',
        operation: 'masked-image-edit',
        asset: 'source',
      }),
      downloadRemoteImage(input.maskImageUrl, {
        provider: 'openrouter',
        operation: 'masked-image-edit',
        asset: 'mask',
      }),
    ])

    assertOpenRouterMaskedEditUploadCompatibility({
      sourceMimeType: sourceImage.mimeType,
      maskMimeType: maskImage.mimeType,
    })

    const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        modalities: ['image', 'text'],
        stream: false,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: buildOpenRouterPrompt(input.prompt),
              },
              {
                type: 'image_url',
                image_url: {
                  url: toDataUrl(sourceImage.bytes, sourceImage.mimeType),
                },
              },
              {
                type: 'image_url',
                image_url: {
                  url: toDataUrl(maskImage.bytes, maskImage.mimeType),
                },
              },
            ],
          },
        ],
      }),
    })

    const responseText = await response.text()
    const responseBody = parseJsonResponseBody(responseText)

    if (!response.ok) {
      throw new ExternalServiceError(
        'OpenRouter image edit request failed',
        {
          provider: 'openrouter',
          operation: 'masked-image-edit',
          model: config.model,
          status: response.status,
          statusText: response.statusText,
          responseBody,
          docsUrl: OPENROUTER_IMAGE_GENERATION_DOCS_URL,
          note: 'This worker uses OpenRouter chat completions with multimodal image inputs because that is the documented image generation and editing path. Exact binary-mask semantics depend on the routed model.',
        },
        response.status,
      )
    }

    const result = extractFirstImageDataUrl(responseBody)
    const image = await resolveOpenRouterResponseImage(result.dataUrl)

    return {
      resultImageBytes: image.bytes,
      resultMimeType: image.mimeType,
      providerRequestId: response.headers.get('x-request-id') ?? result.requestId,
    }
  }
}

export function createOpenRouterImageEditProvider() {
  return new OpenRouterImageEditProvider()
}
