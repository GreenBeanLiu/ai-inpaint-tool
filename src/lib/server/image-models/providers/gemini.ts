import { getMissingEnv, requireEnv } from '@/lib/server/env'
import {
  ConfigurationError,
  ExternalServiceError,
  NotImplementedAppError,
} from '@/lib/server/errors'
import type {
  ImageEditInput,
  ImageEditProvider,
  ImageEditResult,
} from '@/lib/server/image-models/shared'
import { downloadRemoteImage } from '@/lib/server/image-models/shared'

const requiredGeminiEnv = ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_IMAGE_MODEL']

const GEMINI_IMAGE_EDIT_DOCS_URL = 'https://ai.google.dev/gemini-api/docs/image-generation'
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta'

interface GeminiInlineDataPart {
  inlineData?: {
    mimeType?: string
    data?: string
  }
  inline_data?: {
    mime_type?: string
    data?: string
  }
}

function getGeminiConfig() {
  const missingEnv = getMissingEnv(requiredGeminiEnv)

  if (missingEnv.length > 0) {
    throw new ConfigurationError('Gemini image editing integration is not configured', {
      missingEnv,
    })
  }

  return {
    apiKey: requireEnv('GOOGLE_GENERATIVE_AI_API_KEY'),
    model: requireEnv('GOOGLE_IMAGE_MODEL'),
  }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function parseGeminiResponseBody(responseText: string): unknown {
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

function extractInlineImagePart(responseBody: unknown): { data: string; mimeType: string } | null {
  if (!responseBody || typeof responseBody !== 'object') {
    return null
  }

  const candidates = Reflect.get(responseBody, 'candidates')

  if (!Array.isArray(candidates)) {
    return null
  }

  for (const candidate of candidates) {
    const content = candidate && typeof candidate === 'object' ? Reflect.get(candidate, 'content') : null
    const parts = content && typeof content === 'object' ? Reflect.get(content, 'parts') : null

    if (!Array.isArray(parts)) {
      continue
    }

    for (const part of parts as GeminiInlineDataPart[]) {
      const inlineData = part.inlineData
      const legacyInlineData = part.inline_data
      const data = inlineData?.data ?? legacyInlineData?.data
      const mimeType = inlineData?.mimeType ?? legacyInlineData?.mime_type

      if (typeof data === 'string' && typeof mimeType === 'string') {
        return { data, mimeType }
      }
    }
  }

  return null
}

async function runPromptOnlyGeminiEdit(input: ImageEditInput): Promise<ImageEditResult> {
  const config = getGeminiConfig()
  const sourceImage = await downloadRemoteImage(input.sourceImageUrl, {
    provider: 'google',
    operation: 'image-edit',
    asset: 'source',
  })
  const prompt =
    input.prompt?.trim() ||
    'Edit the image while preserving the overall composition and produce only the final edited image.'

  const response = await fetch(
    `${GEMINI_API_URL}/models/${encodeURIComponent(config.model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: input.mimeType ?? sourceImage.mimeType,
                  data: toBase64(sourceImage.bytes),
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      }),
    },
  )

  const responseText = await response.text()
  const responseBody = parseGeminiResponseBody(responseText)

  if (!response.ok) {
    throw new ExternalServiceError('Gemini image edit request failed', {
      provider: 'google',
      operation: 'image-edit',
      model: config.model,
      status: response.status,
      statusText: response.statusText,
      responseBody,
    })
  }

  const inlineImage = extractInlineImagePart(responseBody)

  if (!inlineImage) {
    throw new ExternalServiceError('Gemini image edit response did not include an image', {
      provider: 'google',
      operation: 'image-edit',
      model: config.model,
      responseBody,
    })
  }

  return {
    resultImageBytes: Buffer.from(inlineImage.data, 'base64'),
    resultMimeType: inlineImage.mimeType,
    providerRequestId: response.headers.get('x-request-id') ?? undefined,
  }
}

export class GeminiImageEditProvider implements ImageEditProvider {
  readonly id = 'google'
  readonly displayName = 'Google Gemini'

  supportsMaskInpainting(): boolean {
    return false
  }

  async editImage(input: ImageEditInput): Promise<ImageEditResult> {
    getGeminiConfig()

    const maskImage = await downloadRemoteImage(input.maskImageUrl, {
      provider: 'google',
      operation: 'masked-image-edit',
      asset: 'mask',
    })

    if (maskImage.bytes.byteLength > 0) {
      throw new NotImplementedAppError(
        'Gemini API-key image editing does not support explicit mask-based inpainting in this worker',
        {
          provider: 'google',
          operation: 'masked-image-edit',
          model: requireEnv('GOOGLE_IMAGE_MODEL'),
          maskImageUrl: input.maskImageUrl,
          docsUrl: GEMINI_IMAGE_EDIT_DOCS_URL,
          note: 'The documented Gemini API image editing path accepts text plus image input, but not a separate binary mask image for exact inpainting semantics.',
        },
      )
    }

    return runPromptOnlyGeminiEdit(input)
  }
}

export function createGeminiImageEditProvider() {
  return new GeminiImageEditProvider()
}
