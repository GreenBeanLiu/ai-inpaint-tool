import { ConfigurationError } from '@/lib/server/errors'

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

export function requireEnv(name: string): string {
  const value = readEnv(name)

  if (!value) {
    throw new ConfigurationError(`${name} is required`, {
      missingEnv: [name],
    })
  }

  return value
}

export function getMissingEnv(names: string[]): string[] {
  return names.filter((name) => !readEnv(name))
}
