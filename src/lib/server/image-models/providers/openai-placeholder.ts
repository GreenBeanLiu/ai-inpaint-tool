import { NotImplementedAppError } from '@/lib/server/errors'
import type {
  ImageEditInput,
  ImageEditProvider,
  ImageEditResult,
} from '@/lib/server/image-models/shared'

export class OpenAiPlaceholderImageEditProvider implements ImageEditProvider {
  readonly id = 'openai'
  readonly displayName = 'OpenAI Images'

  supportsMaskInpainting(): boolean {
    return true
  }

  async editImage(_input: ImageEditInput): Promise<ImageEditResult> {
    throw new NotImplementedAppError(
      'OpenAI provider slot is wired but not implemented yet',
      {
        provider: 'openai',
        operation: 'masked-image-edit',
        note: 'This adapter exists as an explicit integration slot for a real mask-capable provider. Implement the API call and result parsing here next.',
      },
    )
  }
}

export function createOpenAiPlaceholderImageEditProvider() {
  return new OpenAiPlaceholderImageEditProvider()
}
