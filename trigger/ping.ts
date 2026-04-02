import { task } from '@trigger.dev/sdk'

export const pingWorker = task({
  id: 'ping',
  run: async () => {
    return {
      ok: true,
      message: 'pong',
      timestamp: new Date().toISOString(),
    }
  },
})
