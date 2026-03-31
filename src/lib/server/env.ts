import { ConfigurationError } from '@/lib/server/errors'

export function getEnv(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

export function requireEnv(name: string): string {
  const value = getEnv(name)

  if (!value) {
    throw new ConfigurationError(`${name} is required`, {
      missingEnv: [name],
    })
  }

  return value
}

export function getMissingEnv(names: readonly string[]): string[] {
  return names.filter((name) => !getEnv(name))
}
