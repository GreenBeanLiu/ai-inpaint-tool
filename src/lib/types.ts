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

export interface ApiErrorPayload {
  code: string
  message: string
  details: Record<string, unknown> | null
}

export interface ApiErrorResponse {
  error: ApiErrorPayload
}

export type RuntimeSectionStatus = 'ready' | 'blocked'

export interface RuntimeSection {
  status: RuntimeSectionStatus
  summary: string
  details: Record<string, unknown> | null
}

export interface RuntimeCheckOverall {
  canListJobs: boolean
  canCreateJob: boolean
  canStartWorker: boolean
  canCompleteDefaultOpenRouterJob: boolean
  blockers: string[]
}

export interface RuntimeCheckReport {
  checkedAt: string
  app: RuntimeSection
  database: RuntimeSection
  storage: RuntimeSection
  triggerDispatch: RuntimeSection
  triggerWorker: RuntimeSection
  defaultProvider: RuntimeSection
  overall: RuntimeCheckOverall
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
