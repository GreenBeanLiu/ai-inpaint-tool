import { createFileRoute } from '@tanstack/react-router'

import { AppError, toErrorResponse } from '@/lib/server/errors'
import { createEditJobRepository } from '@/lib/server/repositories/edit-jobs'

export const Route = createFileRoute('/api/edit-jobs/$jobId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const repository = createEditJobRepository()
          const job = await repository.getById(params.jobId)

          if (!job) {
            throw new AppError('Edit job not found', 'NOT_FOUND', 404, {
              jobId: params.jobId,
            })
          }

          return Response.json({ job })
        } catch (error) {
          return toErrorResponse(error, 'Failed to load edit job')
        }
      },
    },
  },
})
