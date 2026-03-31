import type { Prisma } from '@prisma/client'

import { createEditJobRepository } from '@/lib/server/repositories/edit-jobs'

export async function notifyJobEvent(input: {
  jobId: string
  type: string
  message?: string
  payloadJson?: Prisma.InputJsonValue
}) {
  const repository = createEditJobRepository()

  return repository.addEvent({
    jobId: input.jobId,
    type: input.type,
    message: input.message,
    payloadJson: input.payloadJson,
  })
}
