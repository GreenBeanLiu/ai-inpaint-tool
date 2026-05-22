export type LogContext = Record<string, unknown>

function write(level: 'info' | 'warn' | 'error', message: string, context?: LogContext): void {
  const entry = JSON.stringify({
    level,
    ts: new Date().toISOString(),
    msg: message,
    ...context,
  })

  if (level === 'error') {
    console.error(entry)
  } else if (level === 'warn') {
    console.warn(entry)
  } else {
    console.log(entry)
  }
}

export const logger = {
  info(message: string, context?: LogContext): void {
    write('info', message, context)
  },
  warn(message: string, context?: LogContext): void {
    write('warn', message, context)
  },
  error(message: string, context?: LogContext): void {
    write('error', message, context)
  },
}
