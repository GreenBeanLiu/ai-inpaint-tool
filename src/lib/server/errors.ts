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

export function toErrorResponse(error: unknown, fallbackMessage: string): Response {
  if (error instanceof AppError) {
    return Response.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null,
        },
      },
      { status: error.status },
    )
  }

  const message = error instanceof Error ? error.message : fallbackMessage

  return Response.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message,
        details: null,
      },
    },
    { status: 500 },
  )
}
