import { getEnv } from '@/lib/server/env'

export const DEFAULT_IMAGE_EDIT_PROVIDER = 'tikhub'
export const DEFAULT_OPENROUTER_IMAGE_MODEL = 'openai/gpt-5-image-mini'
export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-1'
export const DEFAULT_TIKHUB_IMAGE_MODEL = 'gpt-image-2'
export const DEFAULT_GOOGLE_IMAGE_MODEL = 'gemini-3.1-flash-image'

export function resolveImageEditProvider(provider: string | undefined): string {
  return provider?.trim() || DEFAULT_IMAGE_EDIT_PROVIDER
}

export function resolveImageEditModel(
  provider: string,
  model: string | undefined,
): string {
  const preferredModel = model?.trim()

  if (preferredModel) {
    return preferredModel
  }

  if (provider === 'openrouter') {
    return getEnv('OPENROUTER_IMAGE_MODEL') ?? DEFAULT_OPENROUTER_IMAGE_MODEL
  }

  if (provider === 'openai') {
    return getEnv('OPENAI_IMAGE_MODEL') ?? DEFAULT_OPENAI_IMAGE_MODEL
  }

  if (provider === 'tikhub') {
    return getEnv('TIKHUB_IMAGE_MODEL') ?? DEFAULT_TIKHUB_IMAGE_MODEL
  }

  if (provider === 'google') {
    return getEnv('GOOGLE_IMAGE_MODEL') ?? DEFAULT_GOOGLE_IMAGE_MODEL
  }

  return getEnv('TIKHUB_IMAGE_MODEL') ?? DEFAULT_TIKHUB_IMAGE_MODEL
}

export function resolveImageEditDefaults(input: {
  provider?: string
  model?: string
}): {
  provider: string
  model: string
} {
  const provider = resolveImageEditProvider(input.provider)

  return {
    provider,
    model: resolveImageEditModel(provider, input.model),
  }
}
