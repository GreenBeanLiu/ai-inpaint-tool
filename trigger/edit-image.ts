import { task } from '@trigger.dev/sdk'

import { runEditImageJob } from '../src/lib/server/jobs/run-edit-image'
import { editImageTask } from '../src/lib/server/trigger/tasks'
import type { EditImageTaskPayload } from '../src/lib/server/trigger/tasks'

export const editImageWorker = task({
  id: editImageTask.id,
  queue: {
    name: editImageTask.queueName,
  },
  run: async (payload: EditImageTaskPayload) => {
    return runEditImageJob(payload)
  },
})
