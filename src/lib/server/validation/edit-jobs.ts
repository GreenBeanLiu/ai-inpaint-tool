import { z } from 'zod'

import { InputError } from '@/lib/server/errors'

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value
  }

  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}, z.string().trim().min(1).optional())

const optionalPositiveInt = z.preprocess((value) => {
  if (value === '' || value === null || value === undefined) {
    return undefined
  }

  return value
}, z.coerce.number().int().positive().optional())

const optionalNonNegativeInt = z.preprocess((value) => {
  if (value === '' || value === null || value === undefined) {
    return undefined
  }

  return value
}, z.coerce.number().int().nonnegative().optional())

export const editJobStatusSchema = z.enum([
  'queued',
  'processing',
  'succeeded',
  'failed',
])

export const allowedEditJobImageMimeTypes = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const

export const maxEditJobImageBytes = 20 * 1024 * 1024

export const createEditJobInputSchema = z.object({
  prompt: optionalTrimmedString,
  sourceImageUrl: z.string().url(),
  maskImageUrl: z.string().url(),
  sourceMimeType: optionalTrimmedString,
  width: optionalPositiveInt,
  height: optionalPositiveInt,
  fileSize: optionalNonNegativeInt,
  provider: optionalTrimmedString.default('google'),
  model: optionalTrimmedString.default('gemini-3.1-flash-image'),
})

export type CreateEditJobInputParsed = z.infer<typeof createEditJobInputSchema>

export const createEditJobMultipartFieldsSchema = z.object({
  prompt: optionalTrimmedString,
  provider: optionalTrimmedString.default('google'),
  model: optionalTrimmedString.default('gemini-3.1-flash-image'),
})

export type CreateEditJobMultipartFieldsParsed = z.infer<
  typeof createEditJobMultipartFieldsSchema
>

function isAllowedImageMimeType(value: string): value is (typeof allowedEditJobImageMimeTypes)[number] {
  return allowedEditJobImageMimeTypes.includes(
    value as (typeof allowedEditJobImageMimeTypes)[number],
  )
}

export function requireMultipartTextField(
  formData: FormData,
  field: string,
): string | undefined {
  const value = formData.get(field)

  if (value == null) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new InputError(`Field ${field} must be submitted as text`, {
      field,
    })
  }

  return value
}

export function requireMultipartImageFile(formData: FormData, field: string): File {
  const value = formData.get(field)

  if (!(value instanceof File)) {
    throw new InputError(`Field ${field} must be submitted as a file`, {
      field,
    })
  }

  if (value.size === 0) {
    throw new InputError(`Field ${field} cannot be empty`, {
      field,
    })
  }

  if (!value.type || !isAllowedImageMimeType(value.type)) {
    throw new InputError(`Field ${field} must be a supported image file`, {
      field,
      allowedMimeTypes: allowedEditJobImageMimeTypes,
      receivedMimeType: value.type || null,
    })
  }

  if (value.size > maxEditJobImageBytes) {
    throw new InputError(`Field ${field} exceeds the maximum allowed size`, {
      field,
      maxBytes: maxEditJobImageBytes,
      receivedBytes: value.size,
    })
  }

  return value
}
