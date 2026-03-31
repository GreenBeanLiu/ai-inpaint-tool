export interface UploadAssetInput {
  key: string
  body: ArrayBuffer | Uint8Array
  contentType: string
}

export interface UploadAssetResult {
  key: string
  url: string
}

function notImplemented(message: string): never {
  throw new Error(`Not implemented: ${message}`)
}

export async function uploadAssetToR2(_input: UploadAssetInput): Promise<UploadAssetResult> {
  notImplemented('Cloudflare R2 upload integration')
}

export function buildR2ObjectUrl(_key: string): string {
  notImplemented('Cloudflare R2 public URL generation')
}
