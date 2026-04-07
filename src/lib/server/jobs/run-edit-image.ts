import type { Prisma } from '@prisma/client'
import { EditJobStatus } from '@prisma/client'

import { AppError } from '@/lib/server/errors'
import { editImageWithProvider } from '@/lib/server/image-models'
import { notifyJobEvent } from '@/lib/server/jobs/notifier'
import { createEditJobRepository } from '@/lib/server/repositories/edit-jobs'
import { uploadAssetToR2 } from '@/lib/server/storage/r2'
import type { EditImageTaskPayload } from '@/lib/server/trigger/tasks'

function toJsonSafeValue(value: unknown): Prisma.InputJsonValue | null {
  if (value == null) {
    return null
  }

  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function getResultAssetKey(jobId: string, mimeType: string): string {
  const extension =
    mimeType === 'image/png'
      ? 'png'
      : mimeType === 'image/webp'
        ? 'webp'
        : mimeType === 'image/jpeg'
          ? 'jpg'
          : 'bin'

  return `results/${jobId}.${extension}`
}

export async function runEditImageJob(input: EditImageTaskPayload) {
  const repository = createEditJobRepository()
  const existingJob = await repository.getById(input.jobId)

  if (!existingJob) {
    throw new AppError('Edit job not found', 'NOT_FOUND', 404, {
      jobId: input.jobId,
    })
  }

  const startedAt = new Date()

  await repository.updateLifecycle(input.jobId, {
    status: EditJobStatus.processing,
    stage: 'preparing',
    progress: 5,
    startedAt,
    errorCode: null,
    errorMessage: null,
  })

  await notifyJobEvent({
    jobId: input.jobId,
    type: 'job.processing',
    message: 'Handed off to the image editing worker.',
  })

  try {
    await repository.updateLifecycle(input.jobId, {
      stage: 'editing',
      progress: 25,
    })

    const modelResult = await editImageWithProvider({
      provider: existingJob.provider,
      sourceImageUrl: existingJob.sourceImageUrl,
      maskImageUrl: existingJob.maskImageUrl,
      prompt: existingJob.prompt ?? undefined,
      mimeType: existingJob.sourceMimeType ?? undefined,
    })

    await repository.updateLifecycle(input.jobId, {
      stage: 'uploading',
      progress: 85,
    })

    const asset = await uploadAssetToR2({
      key: getResultAssetKey(input.jobId, modelResult.resultMimeType),
      body: modelResult.resultImageBytes,
      contentType: modelResult.resultMimeType,
    })

    const finishedAt = new Date()

    const completedJob = await repository.updateLifecycle(input.jobId, {
      status: EditJobStatus.succeeded,
      stage: 'completed',
      progress: 100,
      resultImageUrl: asset.url,
      resultMimeType: modelResult.resultMimeType,
      processingMs: finishedAt.getTime() - startedAt.getTime(),
      finishedAt,
    })

    await notifyJobEvent({
      jobId: input.jobId,
      type: 'job.succeeded',
      message: 'Image edit completed.',
      payloadJson: {
        providerRequestId: modelResult.providerRequestId ?? null,
        resultImageUrl: asset.url,
      },
    })

    return completedJob
  } catch (error) {
    const finishedAt = new Date()
    const appError = error instanceof AppError ? error : null
    const message = error instanceof Error ? error.message : 'Unknown processing failure'

    await repository.updateLifecycle(input.jobId, {
      status: EditJobStatus.failed,
      stage: 'failed',
      errorCode: appError?.code ?? 'PROCESSING_ERROR',
      errorMessage: message,
      processingMs: finishedAt.getTime() - startedAt.getTime(),
      finishedAt,
    })

    await notifyJobEvent({
      jobId: input.jobId,
      type: 'job.failed',
      message,
      payloadJson: {
        code: appError?.code ?? 'PROCESSING_ERROR',
        status: appError?.status ?? 500,
        details: toJsonSafeValue(appError?.details ?? null),
      },
    })

    throw error
  }
}
