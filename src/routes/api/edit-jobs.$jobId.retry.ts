import { EditJobStatus } from '@prisma/client'
import { createFileRoute } from '@tanstack/react-router'

import { AppError, serializeError, toErrorResponse } from '@/lib/server/errors'
import { notifyJobEvent } from '@/lib/server/jobs/notifier'
import { createEditJobRepository } from '@/lib/server/repositories/edit-jobs'
import { triggerTask } from '@/lib/server/trigger/client'
import { editImageTask } from '@/lib/server/trigger/tasks'

export const Route = createFileRoute('/api/edit-jobs/$jobId/retry')({
  server: {
    handlers: {
      POST: async ({ params }) => {
        try {
          const repository = createEditJobRepository()
          const originalJob = await repository.getById(params.jobId)

          if (!originalJob) {
            throw new AppError('Edit job not found', 'NOT_FOUND', 404, {
              jobId: params.jobId,
            })
          }

          if (originalJob.status !== 'failed') {
            throw new AppError('Only failed jobs can be retried', 'INVALID_STATE', 409, {
              jobId: params.jobId,
              status: originalJob.status,
            })
          }

          const newJob = await repository.create({
            prompt: originalJob.prompt ?? undefined,
            sourceImageUrl: originalJob.sourceImageUrl,
            maskImageUrl: originalJob.maskImageUrl,
            sourceMimeType: originalJob.sourceMimeType ?? undefined,
            width: originalJob.width ?? undefined,
            height: originalJob.height ?? undefined,
            fileSize: originalJob.fileSize ?? undefined,
            provider: originalJob.provider,
            model: originalJob.model,
          })

          try {
            const dispatch = await triggerTask(editImageTask, { jobId: newJob.id })

            await repository.updateLifecycle(newJob.id, {
              stage: 'dispatched',
              progress: 1,
            })

            await notifyJobEvent({
              jobId: newJob.id,
              type: 'job.dispatched',
              message: 'Retry job submitted to Trigger.dev.',
              payloadJson: {
                retriedFromJobId: params.jobId,
                taskId: editImageTask.id,
                runId: dispatch.runId,
              },
            })

            const job = await repository.getById(newJob.id)

            return Response.json({ job, retriedFromJobId: params.jobId }, { status: 201 })
          } catch (dispatchError) {
            const serialized = serializeError(dispatchError)
            const finishedAt = new Date()

            await repository.updateLifecycle(newJob.id, {
              status: EditJobStatus.failed,
              stage: 'dispatch_failed',
              progress: 0,
              errorCode: serialized.code,
              errorMessage: serialized.message,
              finishedAt,
            })

            await notifyJobEvent({
              jobId: newJob.id,
              type: 'job.dispatch_failed',
              message: serialized.message,
              payloadJson: {
                retriedFromJobId: params.jobId,
                taskId: editImageTask.id,
                error: {
                  code: serialized.code,
                  message: serialized.message,
                  details: serialized.details,
                },
              },
            })

            const job = await repository.getById(newJob.id)

            return Response.json(
              {
                error: {
                  code: serialized.code,
                  message: serialized.message,
                  details: { ...serialized.details, job, retriedFromJobId: params.jobId },
                },
              },
              { status: serialized.status },
            )
          }
        } catch (error) {
          return toErrorResponse(error, 'Failed to retry edit job')
        }
      },
    },
  },
})
