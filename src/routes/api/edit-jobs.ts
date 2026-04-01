import { randomUUID } from 'node:crypto'

import { createFileRoute } from '@tanstack/react-router'
import type { Prisma } from '@prisma/client'
import { ZodError } from 'zod'

import { readImageMetadata } from '@/lib/server/images/metadata'
import {
  ConfigurationError,
  ExternalServiceError,
  InputError,
  serializeError,
  toErrorResponse,
} from '@/lib/server/errors'
import { notifyJobEvent } from '@/lib/server/jobs/notifier'
import { createEditJobRepository } from '@/lib/server/repositories/edit-jobs'
import { uploadAssetToR2 } from '@/lib/server/storage/r2'
import { triggerTask } from '@/lib/server/trigger/client'
import {
  createEditJobMultipartFieldsSchema,
  requireMultipartImageFile,
  requireMultipartTextField,
} from '@/lib/server/validation/edit-jobs'
import { editImageTask } from '@/lib/server/trigger/tasks'

function toJsonSafeValue(value: unknown): Prisma.InputJsonValue | null {
  if (value == null) {
    return null
  }

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function getUploadExtension(mimeType: string): string {
  if (mimeType === 'image/png') {
    return 'png'
  }

  if (mimeType === 'image/jpeg') {
    return 'jpg'
  }

  if (mimeType === 'image/webp') {
    return 'webp'
  }

  return 'bin'
}

function createUploadedAssetKey(kind: 'source' | 'mask', mimeType: string): string {
  return `uploads/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${kind}.${getUploadExtension(mimeType)}`
}

function getSingleFormData(formData: FormData, field: string): string | undefined {
  const values = formData.getAll(field)

  if (values.length > 1) {
    throw new InputError(`Field ${field} must not be repeated`, {
      field,
      occurrences: values.length,
    })
  }

  return requireMultipartTextField(formData, field)
}

async function parseCreateEditJobRequest(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''

  if (!contentType.includes('multipart/form-data')) {
    throw new InputError('Edit job submission requires multipart form data', {
      acceptedContentTypes: ['multipart/form-data'],
      receivedContentType: contentType || null,
    })
  }

  const formData = await request.formData()
  const sourceImage = requireMultipartImageFile(formData, 'image')
  const maskImage = requireMultipartImageFile(formData, 'mask')
  const fields = createEditJobMultipartFieldsSchema.parse({
    prompt: getSingleFormData(formData, 'prompt'),
    provider: getSingleFormData(formData, 'provider'),
    model: getSingleFormData(formData, 'model'),
  })

  return {
    fields,
    sourceImage,
    maskImage,
  }
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
          const { fields, sourceImage, maskImage } = await parseCreateEditJobRequest(request)
          const [sourceBuffer, maskBuffer] = await Promise.all([
            sourceImage.arrayBuffer(),
            maskImage.arrayBuffer(),
          ])

          const sourceBytes = new Uint8Array(sourceBuffer)
          const maskBytes = new Uint8Array(maskBuffer)
          const sourceMetadata = readImageMetadata(sourceBytes, sourceImage.type)
          const maskMetadata = readImageMetadata(maskBytes, maskImage.type)

          if (
            sourceMetadata.width !== maskMetadata.width ||
            sourceMetadata.height !== maskMetadata.height
          ) {
            throw new InputError('Source image and mask must have identical dimensions', {
              image: sourceMetadata,
              mask: maskMetadata,
            })
          }

          const [sourceAsset, maskAsset] = await Promise.all([
            uploadAssetToR2({
              key: createUploadedAssetKey('source', sourceImage.type),
              body: sourceBytes,
              contentType: sourceImage.type,
            }),
            uploadAssetToR2({
              key: createUploadedAssetKey('mask', maskImage.type),
              body: maskBytes,
              contentType: maskImage.type,
            }),
          ])

          const repository = createEditJobRepository()
          const createdJob = await repository.create({
            prompt: fields.prompt,
            sourceImageUrl: sourceAsset.url,
            maskImageUrl: maskAsset.url,
            sourceMimeType: sourceImage.type,
            width: sourceMetadata.width,
            height: sourceMetadata.height,
            fileSize: sourceImage.size,
            provider: fields.provider,
            model: fields.model,
          })

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
            const status =
              dispatchError instanceof ExternalServiceError ||
              dispatchError instanceof ConfigurationError
                ? dispatchError.status
                : 500

            return Response.json(
              {
                error: {
                  code: serialized.code,
                  message: serialized.message,
                  details: {
                    ...serialized.details,
                    job,
                    dispatch: {
                      attempted: true,
                      status: 'failed',
                      taskId: editImageTask.id,
                    },
                  },
                },
              },
              { status },
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
