import { createFileRoute } from '@tanstack/react-router'
import { ZodError } from 'zod'

import { InputError, toErrorResponse } from '@/lib/server/errors'
import { createEditJobRepository } from '@/lib/server/repositories/edit-jobs'
import { createEditJobInputSchema } from '@/lib/server/validation/edit-jobs'

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
          const job = await repository.create(input)

          return Response.json(
            {
              job,
              dispatch: {
                attempted: false,
                code: 'NOT_IMPLEMENTED',
                message: 'Automatic worker dispatch is not wired yet.',
              },
              message: 'Job stored locally in queued state.',
            },
            { status: 201 },
          )
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
