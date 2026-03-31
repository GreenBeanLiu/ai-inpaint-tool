import { getMissingEnv } from '@/lib/server/env'
import { ConfigurationError, NotImplementedAppError } from '@/lib/server/errors'

export interface GeminiEditImageInput {
  sourceImageUrl: string
  maskImageUrl: string
  prompt?: string
  mimeType?: string
}

export interface GeminiEditImageResult {
  resultImageBytes: Uint8Array
  resultMimeType: string
  providerRequestId?: string
}

const requiredGeminiEnv = ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_IMAGE_MODEL']

export async function editImageWithGemini(_input: GeminiEditImageInput): Promise<GeminiEditImageResult> {
  const missingEnv = getMissingEnv(requiredGeminiEnv)

  if (missingEnv.length > 0) {
    throw new ConfigurationError('Gemini image editing integration is not configured', {
      missingEnv,
    })
  }

  throw new NotImplementedAppError('Gemini image editing call is not implemented yet', {
    requiredEnv: requiredGeminiEnv,
    provider: 'google',
    operation: 'image-edit',
    modelEnv: 'GOOGLE_IMAGE_MODEL',
  })
}
