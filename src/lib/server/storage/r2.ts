import { getMissingEnv } from '@/lib/server/env'
import { ConfigurationError, NotImplementedAppError } from '@/lib/server/errors'

export interface UploadAssetInput {
  key: string
  body: ArrayBuffer | Uint8Array
  contentType: string
}

export interface UploadAssetResult {
  key: string
  url: string
}

const requiredR2Env = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_BASE_URL',
]

function assertR2Configured() {
  const missingEnv = getMissingEnv(requiredR2Env)

  if (missingEnv.length > 0) {
    throw new ConfigurationError('Cloudflare R2 integration is not configured', {
      missingEnv,
    })
  }
}

export async function uploadAssetToR2(_input: UploadAssetInput): Promise<UploadAssetResult> {
  assertR2Configured()
  throw new NotImplementedAppError('Cloudflare R2 upload integration is not wired yet', {
    requiredEnv: requiredR2Env,
  })
}

export function buildR2ObjectUrl(_key: string): string {
  assertR2Configured()
  throw new NotImplementedAppError('Cloudflare R2 public URL generation is not wired yet', {
    requiredEnv: requiredR2Env,
  })
}
