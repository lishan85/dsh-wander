export class WanderError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'WanderError'
    this.code = code
  }
}

export function abortError(): Error {
  const error = new Error('The trip was aborted')
  error.name = 'AbortError'
  return error
}

export function isAbort(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String(error.name) : ''
  if (name === 'AbortError') return true
  const code = 'code' in error ? String(error.code) : ''
  return code === 'ABORT_ERR' || code === 'ERR_ABORTED'
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Remove a secret from a message before it is logged or stored. */
export function redact(text: string, secret: string): string {
  if (!secret) return text
  return text.split(secret).join('[redacted]')
}
