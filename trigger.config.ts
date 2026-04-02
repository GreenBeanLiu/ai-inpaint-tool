import { defineConfig } from '@trigger.dev/sdk'

const project = process.env.TRIGGER_PROJECT_REF?.trim()

if (!project) {
  throw new Error('TRIGGER_PROJECT_REF is required to run Trigger.dev tasks for this project.')
}

export default defineConfig({
  project,
  runtime: 'node',
  dirs: ['./trigger'],
  maxDuration: 300,
})
