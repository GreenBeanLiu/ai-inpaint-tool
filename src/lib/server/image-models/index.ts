import { InputError, NotImplementedAppError } from '@/lib/server/errors'
import {
  createGeminiImageEditProvider,
  GeminiImageEditProvider,
} from '@/lib/server/image-models/providers/gemini'
import { createOpenAiPlaceholderImageEditProvider } from '@/lib/server/image-models/providers/openai-placeholder'
import type {
  ImageEditInput,
  ImageEditProvider,
  ImageEditResult,
} from '@/lib/server/image-models/shared'

const providerFactories = {
  google: () => createGeminiImageEditProvider(),
  openai: () => createOpenAiPlaceholderImageEditProvider(),
} satisfies Record<string, () => ImageEditProvider>

export type SupportedImageEditProviderId = keyof typeof providerFactories

export function listImageEditProviders(): Array<{
  id: SupportedImageEditProviderId
  displayName: string
  supportsMaskInpainting: boolean
}> {
  return (Object.keys(providerFactories) as SupportedImageEditProviderId[]).map((id) => {
    const provider = providerFactories[id]()

    return {
      id,
      displayName: provider.displayName,
      supportsMaskInpainting: provider.supportsMaskInpainting(),
    }
  })
}

export function createImageEditProvider(providerId: string): ImageEditProvider {
  const factory = providerFactories[providerId as SupportedImageEditProviderId]

  if (!factory) {
    throw new InputError('Unsupported image edit provider requested', {
      provider: providerId,
      supportedProviders: Object.keys(providerFactories),
    })
  }

  return factory()
}

export async function editImageWithProvider(input: ImageEditInput & { provider: string }): Promise<ImageEditResult> {
  const provider = createImageEditProvider(input.provider)

  return provider.editImage(input)
}

export function assertProviderSupportsMaskInpainting(providerId: string) {
  const provider = createImageEditProvider(providerId)

  if (!provider.supportsMaskInpainting()) {
    throw new NotImplementedAppError('Selected provider is wired but does not support explicit mask-based inpainting', {
      provider: provider.id,
      displayName: provider.displayName,
      supportedProviders: listImageEditProviders(),
    })
  }
}

export { GeminiImageEditProvider }
