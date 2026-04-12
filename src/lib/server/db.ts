import { PrismaClient } from '@prisma/client'

import { requireEnv } from '@/lib/server/env'
import { ConfigurationError } from '@/lib/server/errors'

declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined
}

function isSupportedDatabaseProtocol(protocol: string) {
  return protocol === 'postgresql:' || protocol === 'postgres:'
}

export function getDatabaseConfigurationIssue(databaseUrl: string):
  | {
      message: string
      details: Record<string, unknown>
    }
  | null {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(databaseUrl)
  } catch {
    return {
      message: 'DATABASE_URL must be a valid PostgreSQL connection string',
      details: {
        env: 'DATABASE_URL',
      },
    }
  }

  if (!isSupportedDatabaseProtocol(parsedUrl.protocol)) {
    return {
      message: 'DATABASE_URL must use a PostgreSQL connection string for this Prisma schema',
      details: {
        env: 'DATABASE_URL',
        receivedProtocol: parsedUrl.protocol.replace(/:$/, ''),
        expectedProtocols: ['postgresql', 'postgres'],
      },
    }
  }

  const username = decodeURIComponent(parsedUrl.username || '').trim()
  const password = decodeURIComponent(parsedUrl.password || '').trim()
  const hostname = parsedUrl.hostname.trim().toLowerCase()
  const databaseName = parsedUrl.pathname.replace(/^\/+/, '').trim().toLowerCase()
  const port = parsedUrl.port.trim()

  const usesExamplePlaceholderValues =
    hostname === 'host' &&
    (!port || port === '5432') &&
    (!databaseName || databaseName === 'database') &&
    (username === '' || username === 'user') &&
    (password === '' || password === 'password')

  if (usesExamplePlaceholderValues) {
    return {
      message: 'DATABASE_URL still points at the example placeholder host',
      details: {
        env: 'DATABASE_URL',
        hint: 'Replace it with a real local or remote PostgreSQL connection string before running the app.',
      },
    }
  }

  return null
}

export function getPrismaClient() {
  if (globalThis.__prisma__) {
    return globalThis.__prisma__
  }

  const databaseUrl = requireEnv('DATABASE_URL')
  const issue = getDatabaseConfigurationIssue(databaseUrl)

  if (issue) {
    throw new ConfigurationError(issue.message, issue.details)
  }

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
