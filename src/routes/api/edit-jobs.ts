import { createFileRoute } from '@tanstack/react-router'

import { createEditJobRepository } from '@/lib/server/repositories/edit-jobs'
import { createEditJobInputSchema } from '@/lib/server/validation/edit-jobs'

export const Route = createFileRoute('/api/edit-jobs')({
  server: {
    handlers: {
      GET: async () => {
        const repository = createEditJobRepository()
        const jobs = await repository.list()

        return Response.json({ jobs })
      },
      POST: async ({ request }) => {
        try {
          const input = createEditJobInputSchema.parse(await request.json())
          const repository = createEditJobRepository()
          const job = await repository.create(input)

          return Response.json(
            {
              job,
              message: 'Job persisted in queued state. Worker dispatch is still TODO.',
            },
            { status: 201 },
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Invalid request'

          return Response.json({ error: message }, { status: 400 })
        }
      },
    },
  },
})
