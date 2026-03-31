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

export async function editImageWithGemini(_input: GeminiEditImageInput): Promise<GeminiEditImageResult> {
  throw new Error('Not implemented: Gemini image editing integration')
}
