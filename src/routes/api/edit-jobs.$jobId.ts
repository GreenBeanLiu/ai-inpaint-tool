import { createFileRoute } from '@tanstack/react-router'

import { createEditJobRepository } from '@/lib/server/repositories/edit-jobs'

export const Route = createFileRoute('/api/edit-jobs/$jobId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const repository = createEditJobRepository()
        const job = await repository.getById(params.jobId)

        if (!job) {
          return Response.json({ error: 'Edit job not found' }, { status: 404 })
        }

        return Response.json({ job })
      },
    },
  },
})
