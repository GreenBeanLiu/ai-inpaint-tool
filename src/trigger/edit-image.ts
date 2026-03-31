import { EditJobStatus } from '@prisma/client'

import { editImageWithGemini } from '@/lib/server/image-models/gemini'
import { notifyJobEvent } from '@/lib/server/jobs/notifier'
import { createEditJobRepository } from '@/lib/server/repositories/edit-jobs'
import { uploadAssetToR2 } from '@/lib/server/storage/r2'

export async function runEditImageJob(jobId: string) {
  const repository = createEditJobRepository()
  const existingJob = await repository.getById(jobId)

  if (!existingJob) {
    throw new Error(`Edit job not found: ${jobId}`)
  }

  const startedAt = new Date()

  await repository.updateLifecycle(jobId, {
    status: EditJobStatus.processing,
    stage: 'preparing',
    progress: 5,
    startedAt,
  })

  await notifyJobEvent({
    jobId,
    type: 'job.processing',
    message: 'Handed off to the image editing worker.',
  })

  try {
    const modelResult = await editImageWithGemini({
      sourceImageUrl: existingJob.sourceImageUrl,
      maskImageUrl: existingJob.maskImageUrl,
      prompt: existingJob.prompt ?? undefined,
      mimeType: existingJob.sourceMimeType ?? undefined,
    })

    const asset = await uploadAssetToR2({
      key: `results/${jobId}`,
      body: modelResult.resultImageBytes,
      contentType: modelResult.resultMimeType,
    })

    const finishedAt = new Date()

    await repository.updateLifecycle(jobId, {
      status: EditJobStatus.succeeded,
      stage: 'completed',
      progress: 100,
      resultImageUrl: asset.url,
      resultMimeType: modelResult.resultMimeType,
      processingMs: finishedAt.getTime() - startedAt.getTime(),
      finishedAt,
    })

    await notifyJobEvent({
      jobId,
      type: 'job.succeeded',
      message: 'Image edit completed.',
      payloadJson: {
        providerRequestId: modelResult.providerRequestId ?? null,
        resultImageUrl: asset.url,
      },
    })
  } catch (error) {
    const finishedAt = new Date()
    const message = error instanceof Error ? error.message : 'Unknown processing failure'

    await repository.updateLifecycle(jobId, {
      status: EditJobStatus.failed,
      stage: 'failed',
      errorCode: 'PROCESSING_ERROR',
      errorMessage: message,
      processingMs: finishedAt.getTime() - startedAt.getTime(),
      finishedAt,
    })

    await notifyJobEvent({
      jobId,
      type: 'job.failed',
      message,
    })

    throw error
  }
}
