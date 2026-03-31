import { getMissingEnv, requireEnv } from '@/lib/server/env'
import { ConfigurationError, ExternalServiceError, RuntimeAppError } from '@/lib/server/errors'

const requiredTriggerEnv = ['TRIGGER_API_URL', 'TRIGGER_SECRET_KEY'] as const

export interface TriggerTaskDefinition<TPayload> {
  id: string
  version?: string
  queue?: string
}

export interface TriggerTaskRunResult {
  runId: string | null
}

function getTriggerConfig() {
  const missingEnv = getMissingEnv(requiredTriggerEnv)

  if (missingEnv.length > 0) {
    throw new ConfigurationError('Trigger.dev integration is not configured', {
      missingEnv,
    })
  }

  return {
    apiUrl: requireEnv('TRIGGER_API_URL').replace(/\/+$/, ''),
    secretKey: requireEnv('TRIGGER_SECRET_KEY'),
  }
}

export async function triggerTask<TPayload>(
  definition: TriggerTaskDefinition<TPayload>,
  payload: TPayload,
): Promise<TriggerTaskRunResult> {
  const { apiUrl, secretKey } = getTriggerConfig()
  const response = await fetch(`${apiUrl}/api/v1/tasks/${definition.id}/trigger`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payload,
      options: {
        queue: definition.queue,
        version: definition.version,
      },
    }),
  })

  if (!response.ok) {
    const responseText = (await response.text()).trim()

    throw new ExternalServiceError('Trigger.dev task dispatch failed', {
      taskId: definition.id,
      status: response.status,
      statusText: response.statusText,
      responseBody: responseText ? responseText.slice(0, 1000) : null,
    })
  }

  const body = (await response.json()) as Record<string, unknown>
  const runId = typeof body.id === 'string' ? body.id : null

  if (body.id !== undefined && runId === null) {
    throw new RuntimeAppError('Trigger.dev dispatch returned an unexpected run identifier', {
      taskId: definition.id,
      responseBody: body,
    })
  }

  return { runId }
}
