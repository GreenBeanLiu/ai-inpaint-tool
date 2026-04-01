export const editImageTask = {
  id: 'edit-image',
  queueName: 'edit-jobs',
} as const

export interface EditImageTaskPayload {
  jobId: string
}
