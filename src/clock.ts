import { abortError, isAbort } from './errors.js'
import type { Clock } from './types.js'

export const systemClock: Clock = {
  now: () => Date.now(),
  wait(ms: number, signal?: AbortSignal) {
    if (ms <= 0) return Promise.resolve()
    if (signal?.aborted) return Promise.reject(abortError())
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = () => {
        clearTimeout(timer)
        reject(abortError())
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  },
}

export async function throwIfAborted(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError()
}

export function asAbort(error: unknown): Error | undefined {
  return isAbort(error) ? (error instanceof Error ? error : abortError()) : undefined
}
