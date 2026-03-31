import { z } from 'zod'

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
