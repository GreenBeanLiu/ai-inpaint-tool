export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIGURATION_ERROR', 500, details)
    this.name = 'ConfigurationError'
  }
}

export class InputError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'INVALID_INPUT', 400, details)
    this.name = 'InputError'
  }
}

export class NotImplementedAppError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'NOT_IMPLEMENTED', 501, details)
    this.name = 'NotImplementedAppError'
  }
}

export class RuntimeAppError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'RUNTIME_ERROR', 500, details)
    this.name = 'RuntimeAppError'
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, details?: Record<string, unknown>, status = 502) {
    super(message, 'EXTERNAL_SERVICE_ERROR', status, details)
    this.name = 'ExternalServiceError'
  }
}

export function serializeError(error: unknown): {
  code: string
  message: string
  status: number
  details: Record<string, unknown> | null
} {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      details: error.details ?? null,
    }
  }

  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : 'Unknown error',
    status: 500,
    details: null,
  }
}

export function toErrorResponse(error: unknown, fallbackMessage: string): Response {
  const serialized = serializeError(error)
  const message =
    serialized.code === 'INTERNAL_ERROR' && serialized.message === 'Unknown error'
      ? fallbackMessage
      : serialized.message

  return Response.json(
    {
      error: {
        code: serialized.code,
        message,
        details: serialized.details,
      },
    },
    { status: serialized.status },
  )
}
