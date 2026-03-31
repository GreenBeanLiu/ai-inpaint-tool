import { PrismaClient } from '@prisma/client'

import { requireEnv } from '@/lib/server/env'

declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined
}

export function getPrismaClient() {
  if (globalThis.__prisma__) {
    return globalThis.__prisma__
  }

  const databaseUrl = requireEnv('DATABASE_URL')
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  })

  if (process.env.NODE_ENV !== 'production') {
    globalThis.__prisma__ = prisma
  }

  return prisma
}
