export const editJobStatuses = ['queued', 'processing', 'succeeded', 'failed'] as const

export type EditJobStatus = (typeof editJobStatuses)[number]

export interface EditJobEventRecord {
  id: string
  jobId: string
  type: string
  message: string | null
  payloadJson: unknown | null
  createdAt: string
}

export interface EditJobRecord {
  id: string
  status: EditJobStatus
  stage: string | null
  progress: number | null
  prompt: string | null
  sourceImageUrl: string
  maskImageUrl: string
  resultImageUrl: string | null
  sourceMimeType: string | null
  resultMimeType: string | null
  width: number | null
  height: number | null
  fileSize: number | null
  provider: string
  model: string
  errorCode: string | null
  errorMessage: string | null
  processingMs: number | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface EditJobDetail extends EditJobRecord {
  events: EditJobEventRecord[]
}

export interface CreateEditJobInput {
  prompt?: string
  sourceImageUrl: string
  maskImageUrl: string
  sourceMimeType?: string
  width?: number
  height?: number
  fileSize?: number
  provider?: string
  model?: string
}
