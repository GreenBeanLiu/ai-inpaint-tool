import { defineConfig } from '@trigger.dev/sdk'
import { prismaExtension } from '@trigger.dev/build/extensions/prisma'

export default defineConfig({
  project: 'proj_xlxnaonafajdgyslmorw',
  runtime: 'node',
  dirs: ['./trigger'],
  maxDuration: 300,
  build: {
    extensions: [
      prismaExtension({
        schema: './prisma/schema.prisma',
      }),
    ],
  },
})
