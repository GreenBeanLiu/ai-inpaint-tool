import { Prisma } from '@prisma/client'

import { getDatabaseConfigurationIssue, getPrismaClient } from '@/lib/server/db'
import { getEnv, getMissingEnv } from '@/lib/server/env'
import {
  DEFAULT_IMAGE_EDIT_PROVIDER,
  resolveImageEditModel,
} from '@/lib/server/image-models/defaults'

const requiredR2Env = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
  'R2_PUBLIC_BASE_URL',
] as const

const requiredTriggerDispatchEnv = ['TRIGGER_API_URL', 'TRIGGER_SECRET_KEY'] as const
const requiredTriggerWorkerEnv = ['TRIGGER_PROJECT_REF'] as const
const requiredDefaultProviderEnv = ['OPENROUTER_API_KEY'] as const

type RuntimeSectionStatus = 'ready' | 'blocked'

interface RuntimeSection {
  status: RuntimeSectionStatus
  summary: string
  details: Record<string, unknown> | null
}

function createReadySection(
  summary: string,
  details?: Record<string, unknown>,
): RuntimeSection {
  return {
    status: 'ready',
    summary,
    details: details ?? null,
  }
}

function createBlockedSection(
  summary: string,
  details?: Record<string, unknown>,
): RuntimeSection {
  return {
    status: 'blocked',
    summary,
    details: details ?? null,
  }
}

function createEnvSection(
  missingEnv: readonly string[],
  readySummary: string,
  blockedSummary: string,
): RuntimeSection {
  if (missingEnv.length === 0) {
    return createReadySection(readySummary)
  }

  return createBlockedSection(blockedSummary, {
    missingEnv,
  })
}

async function getDatabaseSection(): Promise<RuntimeSection> {
  const databaseUrl = getEnv('DATABASE_URL')

  if (!databaseUrl) {
    return createBlockedSection('Database access is blocked because DATABASE_URL is missing.', {
      missingEnv: ['DATABASE_URL'],
    })
  }

  const issue = getDatabaseConfigurationIssue(databaseUrl)

  if (issue) {
    return createBlockedSection(issue.message, issue.details)
  }

  try {
    await getPrismaClient().$queryRawUnsafe('SELECT 1')

    return createReadySection('Database connectivity is working for Prisma-backed job reads and writes.')
  } catch (error) {
    if (error instanceof Prisma.PrismaClientInitializationError) {
      return createBlockedSection(
        'Database connectivity failed. Check DATABASE_URL and make sure PostgreSQL is reachable.',
        {
          prismaErrorCode: error.errorCode ?? null,
        },
      )
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2021' || error.code === 'P2022') {
        return createBlockedSection(
          'Database schema is incomplete for this app. Run `npm run prisma:push` against the configured database.',
          {
            prismaErrorCode: error.code,
          },
        )
      }
    }

    return createBlockedSection('Database preflight failed with an unexpected error.', {
      message: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

export async function getRuntimeCheckReport() {
  const database = await getDatabaseSection()
  const storage = createEnvSection(
    getMissingEnv(requiredR2Env),
    'Cloudflare R2 upload/download configuration is present.',
    'Cloudflare R2 upload/download is blocked by missing configuration.',
  )
  const triggerDispatch = createEnvSection(
    getMissingEnv(requiredTriggerDispatchEnv),
    'Trigger.dev dispatch configuration is present.',
    'Trigger.dev dispatch is blocked by missing configuration.',
  )
  const triggerWorker = createEnvSection(
    getMissingEnv(requiredTriggerWorkerEnv),
    'Trigger.dev worker startup configuration is present.',
    'Trigger.dev worker startup is blocked by missing configuration.',
  )
  const defaultProvider = createEnvSection(
    getMissingEnv(requiredDefaultProviderEnv),
    `Default provider ${DEFAULT_IMAGE_EDIT_PROVIDER} is configured.`,
    `Default provider ${DEFAULT_IMAGE_EDIT_PROVIDER} is blocked by missing configuration.`,
  )

  const defaultModel = resolveImageEditModel(DEFAULT_IMAGE_EDIT_PROVIDER, undefined)
  const canListJobs = database.status === 'ready'
  const canCreateJob =
    database.status === 'ready' &&
    storage.status === 'ready' &&
    triggerDispatch.status === 'ready'
  const canStartWorker = triggerWorker.status === 'ready'
  const canCompleteDefaultOpenRouterJob =
    canCreateJob &&
    canStartWorker &&
    defaultProvider.status === 'ready'

  const blockers = [
    storage,
    database,
    triggerDispatch,
    triggerWorker,
    defaultProvider,
  ]
    .filter((section) => section.status === 'blocked')
    .map((section) => section.summary)

  return {
    checkedAt: new Date().toISOString(),
    app: createReadySection('The built TanStack Start server can boot and answer in-process requests.'),
    database,
    storage,
    triggerDispatch,
    triggerWorker,
    defaultProvider: {
      ...defaultProvider,
      details: {
        ...(defaultProvider.details ?? {}),
        provider: DEFAULT_IMAGE_EDIT_PROVIDER,
        model: defaultModel,
      },
    },
    overall: {
      canListJobs,
      canCreateJob,
      canStartWorker,
      canCompleteDefaultOpenRouterJob,
      blockers,
    },
  }
}
