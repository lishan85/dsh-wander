import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { MIN_IMAGE_BYTES, USER_AGENT } from './constants.js'
import { systemClock } from './clock.js'
import { WanderError, abortError, errorText, isAbort } from './errors.js'
import type { Clock } from './types.js'

export interface PublicUrlCheck {
  ok: true
  url: URL
}

export interface UrlRejection {
  ok: false
  message: string
}

export function checkPublicUrl(raw: string, allowedHosts?: readonly string[]): PublicUrlCheck | UrlRejection {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, message: 'snapshot URL is not valid' }
  }
  if (url.protocol !== 'https:') return { ok: false, message: 'snapshot URL must use https' }
  if (url.username || url.password) return { ok: false, message: 'snapshot URL must not contain credentials' }
  const host = url.hostname.toLowerCase()
  if (!host) return { ok: false, message: 'snapshot URL is missing a host' }
  if (isBlockedHostname(host)) return { ok: false, message: `host ${host} is not a public camera` }
  if (isIP(host) && isPrivateAddress(host)) return { ok: false, message: `address ${host} is not public` }
  if (allowedHosts && allowedHosts.length > 0 && !hostAllowed(host, allowedHosts)) {
    return { ok: false, message: `host ${host} is outside the allow list` }
  }
  return { ok: true, url }
}

export async function assertResolvedPublic(host: string, resolve: HostResolver = resolveHost): Promise<void> {
  const addresses = await resolve(host)
  if (addresses.length === 0) throw new WanderError('blocked', `could not resolve ${host}`)
  for (const address of addresses) {
    if (isPrivateAddress(address) || isBlockedHostname(address)) {
      throw new WanderError('blocked', `${host} resolved to a non-public address`)
    }
  }
}

export type HostResolver = (host: string) => Promise<string[]>

export async function resolveHost(host: string): Promise<string[]> {
  if (isIP(host)) return [host]
  const records = await lookup(host, { all: true, verbatim: true })
  return records.map((record) => record.address)
}

export function isBlockedHostname(host: string): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local')) return true
  if (name === '0.0.0.0' || name === '::' || name === '::1') return true
  if (name.endsWith('.internal')) return true
  return false
}

export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase()
  if (ip.includes(':')) {
    if (ip === '::1' || ip === '::') return true
    if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80') || ip.startsWith('fec0')) return true
    const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip)
    if (mapped?.[1]) return isPrivateAddress(mapped[1])
    return false
  }
  const parts = ip.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const a = parts[0] ?? 0
  const b = parts[1] ?? 0
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

export interface SniffedImage {
  ext: 'jpg' | 'png' | 'gif' | 'webp'
  mediaType: string
}

export function sniffImage(bytes: Uint8Array): SniffedImage | undefined {
  if (bytes.byteLength < MIN_IMAGE_BYTES) return undefined
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: 'jpg', mediaType: 'image/jpeg' }
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: 'png', mediaType: 'image/png' }
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return { ext: 'gif', mediaType: 'image/gif' }
  }
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { ext: 'webp', mediaType: 'image/webp' }
  }
  return undefined
}

export type FetchSnapshotResult =
  | { ok: true; bytes: Uint8Array; mediaType: string; ext: string; etag: string; finalUrl: string }
  | { ok: false; code: 'not-modified' | 'http' | 'invalid-image' | 'network' | 'blocked' | 'too-large'; message: string; status?: number; retryable: boolean }

export interface FetchSnapshotOptions {
  url: string
  allowedHosts: readonly string[]
  headers?: Readonly<Record<string, string>>
  etag?: string
  timeoutMs: number
  retries: number
  maxBytes: number
  minHostIntervalMs: number
  limiter: HostLimiter
  fetchImpl?: typeof fetch
  resolve?: HostResolver
  signal?: AbortSignal
  clock?: Clock
}

export async function fetchSnapshot(options: FetchSnapshotOptions): Promise<FetchSnapshotResult> {
  const attempts = options.retries + 1
  let last: FetchSnapshotResult | undefined
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted) throw abortError()
    try {
      const result = await fetchOnce(options)
      if (result.ok || !result.retryable || attempt === attempts) return result
      last = result
    } catch (error) {
      if (isAbort(error)) throw error instanceof Error ? error : abortError()
      const blocked = error instanceof WanderError && error.code === 'blocked'
      last = {
        ok: false,
        code: blocked ? 'blocked' : 'network',
        message: errorText(error),
        retryable: !blocked,
      }
      if (!last.retryable || attempt === attempts) return last
    }
    const clock = options.clock ?? systemClock
    await clock.wait(200 * attempt, options.signal)
  }
  return last ?? { ok: false, code: 'network', message: 'fetch failed', retryable: false }
}

async function fetchOnce(options: FetchSnapshotOptions): Promise<FetchSnapshotResult> {
  const checked = checkPublicUrl(options.url, options.allowedHosts)
  if (!checked.ok) return { ok: false, code: 'blocked', message: checked.message, retryable: false }
  await assertResolvedPublic(checked.url.hostname, options.resolve)
  await options.limiter.wait(checked.url.hostname, options.minHostIntervalMs, options.signal)
  return follow(checked.url, options, 0)
}

async function follow(url: URL, options: FetchSnapshotOptions, redirects: number): Promise<FetchSnapshotResult> {
  if (options.signal?.aborted) throw abortError()
  const checked = checkPublicUrl(url.href, options.allowedHosts)
  if (!checked.ok) return { ok: false, code: 'blocked', message: checked.message, retryable: false }
  await assertResolvedPublic(checked.url.hostname, options.resolve)
  const headers = new Headers()
  headers.set('user-agent', USER_AGENT)
  headers.set('accept', 'image/jpeg,image/png,image/webp,image/gif,*/*;q=0.1')
  if (options.etag) headers.set('if-none-match', options.etag)
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) headers.set(key, value)
  }
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const response = await fetchImpl(checked.url, { redirect: 'manual', headers, signal })
  if (response.status === 304) {
    return { ok: false, code: 'not-modified', message: 'snapshot has not changed', status: 304, retryable: false }
  }
  if (isRedirect(response.status)) {
    if (redirects >= 3) {
      return { ok: false, code: 'blocked', message: 'too many redirects', status: response.status, retryable: false }
    }
    const location = response.headers.get('location')
    if (!location) {
      return { ok: false, code: 'http', message: 'redirect missing location', status: response.status, retryable: false }
    }
    const next = new URL(location, checked.url)
    return follow(next, options, redirects + 1)
  }
  if (response.status === 429 || response.status >= 500) {
    return { ok: false, code: 'http', message: `HTTP ${response.status}`, status: response.status, retryable: true }
  }
  if (response.status !== 200) {
    return { ok: false, code: 'http', message: `HTTP ${response.status}`, status: response.status, retryable: false }
  }
  const body = await readBody(response, options.maxBytes, signal)
  if (body === 'too-large') {
    return { ok: false, code: 'too-large', message: 'snapshot exceeds maxImageBytes', status: 200, retryable: false }
  }
  if (looksLikeHtml(body)) {
    return { ok: false, code: 'invalid-image', message: 'response was HTML, not an image', status: 200, retryable: false }
  }
  const sniffed = sniffImage(body)
  if (!sniffed) {
    return { ok: false, code: 'invalid-image', message: 'response was not a JPEG, PNG, GIF, or WebP', status: 200, retryable: false }
  }
  return {
    ok: true,
    bytes: body,
    mediaType: sniffed.mediaType,
    ext: sniffed.ext,
    etag: response.headers.get('etag') ?? '',
    finalUrl: checked.url.href,
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

async function readBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array | 'too-large'> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) return 'too-large'
  if (!response.body) {
    const buffered = new Uint8Array(await response.arrayBuffer())
    return buffered.byteLength > maxBytes ? 'too-large' : buffered
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      if (signal.aborted) throw abortError()
      const step = await reader.read()
      if (step.done) break
      if (!step.value) continue
      total += step.value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return 'too-large'
      }
      chunks.push(step.value)
    }
  } finally {
    reader.releaseLock()
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 64)).toString('utf8').trimStart().toLowerCase()
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<head')
}

export class HostLimiter {
  #last = new Map<string, number>()

  constructor(private readonly clock: Clock = systemClock) {}

  async wait(host: string, minMs: number, signal?: AbortSignal): Promise<void> {
    if (minMs <= 0) {
      this.#last.set(host, this.clock.now())
      return
    }
    const elapsed = this.clock.now() - (this.#last.get(host) ?? Number.NEGATIVE_INFINITY)
    const delay = minMs - elapsed
    if (delay > 0) await this.clock.wait(delay, signal)
    this.#last.set(host, this.clock.now())
  }
}

export function hostAllowed(host: string, allowed: readonly string[]): boolean {
  const name = host.toLowerCase()
  return allowed.some((item) => item.toLowerCase() === name)
}
