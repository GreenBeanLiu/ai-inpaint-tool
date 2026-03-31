import type { EditJob, EditJobEvent, Prisma, PrismaClient } from '@prisma/client'
import { EditJobStatus } from '@prisma/client'

import { getPrismaClient } from '@/lib/server/db'
import type {
  CreateEditJobInput,
  EditJobDetail,
  EditJobEventRecord,
  EditJobRecord,
  EditJobStatus as EditJobStatusValue,
} from '@/lib/types'

type EditJobWithEvents = EditJob & {
  events: EditJobEvent[]
}

function mapEvent(event: EditJobEvent): EditJobEventRecord {
  return {
    id: event.id,
    jobId: event.jobId,
    type: event.type,
    message: event.message,
    payloadJson: event.payloadJson,
    createdAt: event.createdAt.toISOString(),
  }
}

function mapJob(job: EditJob): EditJobRecord {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    prompt: job.prompt,
    sourceImageUrl: job.sourceImageUrl,
    maskImageUrl: job.maskImageUrl,
    resultImageUrl: job.resultImageUrl,
    sourceMimeType: job.sourceMimeType,
    resultMimeType: job.resultMimeType,
    width: job.width,
    height: job.height,
    fileSize: job.fileSize,
    provider: job.provider,
    model: job.model,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    processingMs: job.processingMs,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  }
}

function mapJobDetail(job: EditJobWithEvents): EditJobDetail {
  return {
    ...mapJob(job),
    events: job.events.map(mapEvent),
  }
}

export interface EditJobRepository {
  create(input: CreateEditJobInput): Promise<EditJobDetail>
  getById(jobId: string): Promise<EditJobDetail | null>
  list(): Promise<EditJobRecord[]>
  addEvent(input: {
    jobId: string
    type: string
    message?: string
    payloadJson?: Prisma.InputJsonValue
  }): Promise<EditJobEventRecord>
  updateLifecycle(
    jobId: string,
    patch: {
      status?: EditJobStatusValue
      stage?: string | null
      progress?: number | null
      resultImageUrl?: string | null
      resultMimeType?: string | null
      errorCode?: string | null
      errorMessage?: string | null
      processingMs?: number | null
      width?: number | null
      height?: number | null
      fileSize?: number | null
      startedAt?: Date | null
      finishedAt?: Date | null
    },
  ): Promise<EditJobDetail>
}

export function createEditJobRepository(prismaClient: PrismaClient = getPrismaClient()): EditJobRepository {
  return {
    async create(input) {
      const job = await prismaClient.editJob.create({
        data: {
          prompt: input.prompt,
          sourceImageUrl: input.sourceImageUrl,
          maskImageUrl: input.maskImageUrl,
          sourceMimeType: input.sourceMimeType,
          width: input.width,
          height: input.height,
          fileSize: input.fileSize,
          provider: input.provider ?? 'google',
          model: input.model ?? 'gemini-3.1-flash-image',
          status: EditJobStatus.queued,
          stage: 'accepted',
          progress: 0,
          events: {
            create: [
              {
                type: 'job.accepted',
                message: 'Edit job accepted and stored in the local queue.',
              },
              {
                type: 'job.dispatch_pending',
                message: 'Automatic worker dispatch is not implemented in this scaffold yet.',
              },
            ],
          },
        },
        include: {
          events: {
            orderBy: { createdAt: 'desc' },
          },
        },
      })

      return mapJobDetail(job)
    },

    async getById(jobId) {
      const job = await prismaClient.editJob.findUnique({
        where: { id: jobId },
        include: {
          events: {
            orderBy: { createdAt: 'desc' },
          },
        },
      })

      return job ? mapJobDetail(job) : null
    },

    async list() {
      const jobs = await prismaClient.editJob.findMany({
        orderBy: { createdAt: 'desc' },
      })

      return jobs.map(mapJob)
    },

    async addEvent(input) {
      const event = await prismaClient.editJobEvent.create({
        data: {
          jobId: input.jobId,
          type: input.type,
          message: input.message,
          payloadJson: input.payloadJson,
        },
      })

      return {
        id: event.id,
        jobId: event.jobId,
        type: event.type,
        message: event.message,
        payloadJson: event.payloadJson,
        createdAt: event.createdAt.toISOString(),
      }
    },

    async updateLifecycle(jobId, patch) {
      const job = await prismaClient.editJob.update({
        where: { id: jobId },
        data: {
          status: patch.status,
          stage: patch.stage,
          progress: patch.progress,
          resultImageUrl: patch.resultImageUrl,
          resultMimeType: patch.resultMimeType,
          errorCode: patch.errorCode,
          errorMessage: patch.errorMessage,
          processingMs: patch.processingMs,
          width: patch.width,
          height: patch.height,
          fileSize: patch.fileSize,
          startedAt: patch.startedAt,
          finishedAt: patch.finishedAt,
        },
        include: {
          events: {
            orderBy: { createdAt: 'desc' },
          },
        },
      })

      return mapJobDetail(job)
    },
  }
}
