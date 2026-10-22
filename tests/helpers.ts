import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Clock } from '../src/types.js'

export function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'dsh-wander-'))
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

export function jpeg(size = 320): Uint8Array {
  const bytes = new Uint8Array(size)
  bytes[0] = 0xff
  bytes[1] = 0xd8
  bytes[2] = 0xff
  bytes[3] = 0xe0
  bytes[size - 2] = 0xff
  bytes[size - 1] = 0xd9
  return bytes
}

export function imageResponse(bytes: Uint8Array, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(Buffer.from(bytes), {
    status,
    headers: { 'content-type': 'image/jpeg', ...extra },
  })
}

export class ManualClock implements Clock {
  t = 1_000
  waits: number[] = []

  now(): number {
    return this.t
  }

  async wait(ms: number): Promise<void> {
    this.waits.push(ms)
    this.t += ms
  }
}

export const publicResolve = async () => ['1.1.1.1']
