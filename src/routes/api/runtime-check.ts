import { createFileRoute } from '@tanstack/react-router'

import { toErrorResponse } from '@/lib/server/errors'
import { getRuntimeCheckReport } from '@/lib/server/runtime-check'

export const Route = createFileRoute('/api/runtime-check')({
  server: {
    handlers: {
      GET: async () => {
        try {
          const report = await getRuntimeCheckReport()

          return Response.json(report)
        } catch (error) {
          return toErrorResponse(error, 'Failed to run runtime check')
        }
      },
    },
  },
})
