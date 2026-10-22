import { WINDY_API_URL, WINDY_IMAGE_HOSTS, WINDY_TOS_URL, USER_AGENT } from './constants.js'
import { abortError, errorText, isAbort, redact } from './errors.js'
import { checkPublicUrl } from './net.js'
import { assertTimezone } from './policy.js'
import type { Place } from './types.js'

export function parseWindyWebcams(payload: unknown): Place[] {
  const list = webcamList(payload)
  const places: Place[] = []
  for (const item of list) {
    const place = toPlace(item)
    if (place) places.push(place)
  }
  return places
}

export async function fetchWindyPlaces(options: {
  apiKey: string
  rng: () => number
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  timeoutMs: number
}): Promise<Place[]> {
  const offset = Math.floor(options.rng() * 30) * 10
  const url = new URL(WINDY_API_URL)
  url.searchParams.set('include', 'images,location,urls')
  url.searchParams.set('limit', '10')
  url.searchParams.set('offset', String(offset))
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: {
        'x-windy-api-key': options.apiKey,
        accept: 'application/json',
        'user-agent': USER_AGENT,
      },
      signal,
    })
  } catch (error) {
    if (isAbort(error)) throw abortError()
    throw new Error(redact(errorText(error), options.apiKey))
  }
  if (!response.ok) {
    const body = redact(await response.text(), options.apiKey)
    throw new Error(`Windy HTTP ${response.status}: ${body.slice(0, 180)}`)
  }
  const payload: unknown = await response.json()
  return parseWindyWebcams(payload)
}

function webcamList(payload: unknown): unknown[] {
  if (!payload || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>
  if (Array.isArray(record.webcams)) return record.webcams
  const result = record.result
  if (result && typeof result === 'object' && Array.isArray((result as Record<string, unknown>).webcams)) {
    return (result as Record<string, unknown>).webcams as unknown[]
  }
  return []
}

function toPlace(item: unknown): Place | undefined {
  if (!item || typeof item !== 'object') return undefined
  const webcam = item as Record<string, unknown>
  const rawId = webcam.webcamId ?? webcam.id
  if (typeof rawId !== 'number' && typeof rawId !== 'string') return undefined
  const location = asRecord(webcam.location)
  const country = text(location?.country)
  if (!country) return undefined
  const snapshotUrl = pickImage(webcam.images)
  if (!snapshotUrl) return undefined
  const checked = checkPublicUrl(snapshotUrl, WINDY_IMAGE_HOSTS)
  if (!checked.ok) return undefined
  const timezone = text(location?.timezone) || 'UTC'
  try {
    assertTimezone(timezone === 'UTC' ? 'UTC' : timezone)
  } catch {
    return undefined
  }
  const latitude = numberOr(location?.latitude, 0)
  const longitude = numberOr(location?.longitude, 0)
  const urls = asRecord(webcam.urls)
  const pageUrl = text(urls?.detail) || 'https://www.windy.com/webcams'
  return {
    id: `windy-${String(rawId)}`,
    name: text(webcam.title) || `Windy ${String(rawId)}`,
    region: text(location?.region) || text(location?.city) || '',
    country,
    timezone,
    latitude,
    longitude,
    snapshotUrl,
    pageUrl: pageUrl.startsWith('https://') ? pageUrl : 'https://www.windy.com/webcams',
    attribution: 'Image via Windy.com Webcams API. Attribute Windy.',
    license: 'Windy Webcams API terms',
    tosUrl: WINDY_TOS_URL,
    allowedHosts: WINDY_IMAGE_HOSTS,
    source: 'windy',
  }
}

function pickImage(images: unknown): string {
  const current = asRecord(asRecord(images)?.current)
  return text(current?.preview) || text(current?.thumbnail) || text(current?.icon)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined
  return value as Record<string, unknown>
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
