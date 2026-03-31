import { z } from 'zod'

export const editJobStatusSchema = z.enum([
  'queued',
  'processing',
  'succeeded',
  'failed',
])

export const createEditJobInputSchema = z.object({
  prompt: z.string().trim().min(1).optional(),
  sourceImageUrl: z.string().url(),
  maskImageUrl: z.string().url(),
  sourceMimeType: z.string().trim().min(1).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fileSize: z.number().int().nonnegative().optional(),
  provider: z.string().trim().min(1).default('google'),
  model: z.string().trim().min(1).default('gemini-3.1-flash-image'),
})

export type CreateEditJobInputParsed = z.infer<typeof createEditJobInputSchema>
