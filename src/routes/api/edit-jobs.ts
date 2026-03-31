import { createFileRoute } from '@tanstack/react-router'
import type { Prisma } from '@prisma/client'
import { ZodError } from 'zod'

import { InputError, serializeError, toErrorResponse } from '@/lib/server/errors'
import { notifyJobEvent } from '@/lib/server/jobs/notifier'
import { createEditJobRepository } from '@/lib/server/repositories/edit-jobs'
import { triggerTask } from '@/lib/server/trigger/client'
import { createEditJobInputSchema } from '@/lib/server/validation/edit-jobs'
import { editImageTask } from '@/trigger/edit-image'

function toJsonSafeValue(value: unknown): Prisma.InputJsonValue | null {
  if (value == null) {
    return null
  }

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

async function readCreateEditJobBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return request.json()
  }

  if (
    contentType.includes('multipart/form-data') ||
    contentType.includes('application/x-www-form-urlencoded')
  ) {
    const formData = await request.formData()

    return Object.fromEntries(
      Array.from(formData.entries()).map(([key, value]) => {
        if (typeof value !== 'string') {
          throw new InputError(`Field ${key} must be submitted as text`, {
            field: key,
          })
        }

        return [key, value]
      }),
    )
  }

  throw new InputError('Unsupported content type', {
    acceptedContentTypes: [
      'application/json',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
    ],
  })
}

export const Route = createFileRoute('/api/edit-jobs')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const repository = createEditJobRepository()
          const jobs = await repository.list()

          return Response.json({ jobs })
        } catch (error) {
          return toErrorResponse(error, 'Failed to load edit jobs')
        }
      },
      POST: async ({ request }) => {
        try {
          const input = createEditJobInputSchema.parse(await readCreateEditJobBody(request))
          const repository = createEditJobRepository()
          const createdJob = await repository.create(input)

          try {
            const dispatch = await triggerTask(editImageTask, {
              jobId: createdJob.id,
            })

            await repository.updateLifecycle(createdJob.id, {
              stage: 'dispatched',
              progress: 1,
            })

            await notifyJobEvent({
              jobId: createdJob.id,
              type: 'job.dispatched',
              message: 'Edit job submitted to Trigger.dev.',
              payloadJson: {
                taskId: editImageTask.id,
                runId: dispatch.runId,
              },
            })

            const job = await repository.getById(createdJob.id)

            return Response.json(
              {
                job,
                dispatch: {
                  attempted: true,
                  status: 'submitted',
                  taskId: editImageTask.id,
                  runId: dispatch.runId,
                },
              },
              { status: 201 },
            )
          } catch (dispatchError) {
            const serialized = serializeError(dispatchError)

            await repository.updateLifecycle(createdJob.id, {
              stage: 'dispatch_failed',
              progress: 0,
              errorCode: serialized.code,
              errorMessage: serialized.message,
            })

            await notifyJobEvent({
              jobId: createdJob.id,
              type: 'job.dispatch_failed',
              message: serialized.message,
              payloadJson: {
                taskId: editImageTask.id,
                error: {
                  ...serialized,
                  details: toJsonSafeValue(serialized.details),
                },
              },
            })

            const job = await repository.getById(createdJob.id)

            return Response.json(
              {
                job,
                dispatch: {
                  attempted: true,
                  status: 'failed',
                  taskId: editImageTask.id,
                  error: serialized,
                },
              },
              { status: 201 },
            )
          }

        } catch (error) {
          if (error instanceof ZodError) {
            return toErrorResponse(
              new InputError('Request validation failed', {
                issues: error.issues.map((issue) => ({
                  path: issue.path.join('.'),
                  message: issue.message,
                })),
              }),
              'Invalid request',
            )
          }

          return toErrorResponse(error, 'Failed to create edit job')
        }
      },
    },
  },
})
