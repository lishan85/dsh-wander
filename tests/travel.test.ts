import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { TripStore } from '../src/store.js'
import { TravelService } from '../src/travel.js'
import { imageResponse, jpeg, ManualClock, publicResolve, removeDir, tempDir } from './helpers.js'

const dirs: string[] = []
const fixed = new Date('2026-10-22T12:00:00Z')

afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir)
})

describe('travel', () => {
  it('stores a metadata diary for one named camera and does not switch places', async () => {
    const urls: string[] = []
    const { travel, store } = setup({
      fetchImpl: async (input) => {
        urls.push(String(input))
        return imageResponse(jpeg(), 200, { etag: '"h"' })
      },
    })
    const result = await travel.travel({ trigger: 'manual', placeId: 'hanko' })
    expect(result.ok).toBe(true)
    expect(result.trip?.placeId).toBe('hanko')
    expect(result.trip?.descriptionMode).toBe('metadata')
    expect(result.trip?.descriptionReason).toBe('metadata')
    expect(result.trip?.diary).toContain('没有交给视觉模型')
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('C0150701.jpg')
    const saved = readFileSync(result.trip?.imagePath ?? '')
    expect(saved[0]).toBe(0xff)
    expect(saved[1]).toBe(0xd8)
    expect(store.listRecent(1)).toHaveLength(1)
    store.close()
  })

  it('returns unknown-place without fetching and keeps a failing named camera from falling through', async () => {
    let calls = 0
    const { travel, store } = setup({
      fetchImpl: async () => {
        calls += 1
        return new Response('no', { status: 404 })
      },
    })
    const unknown = await travel.travel({ trigger: 'manual', placeId: 'nope' })
    expect(unknown.code).toBe('unknown-place')
    expect(calls).toBe(0)
    const missing = await travel.travel({ trigger: 'manual', placeId: 'reykjanes' })
    expect(missing.code).toBe('sources-failed')
    expect(calls).toBe(1)
    expect(store.listRecent(5)).toHaveLength(0)
    store.close()
  })

  it('falls back when vision is capped and still records the attempt budget', async () => {
    const urls: string[] = []
    const { travel, store } = setup({
      config: {
        visionProvider: 'openai',
        visionBaseUrl: 'https://example.com/v1',
        visionApiKey: 'sk-test-secret',
        visionModel: 'demo',
        maxVisionCallsPerDay: 0,
      },
      fetchImpl: async (input) => {
        urls.push(String(input))
        return imageResponse(jpeg())
      },
    })
    const result = await travel.travel({ trigger: 'manual', placeId: 'hanko', force: true })
    expect(result.ok).toBe(true)
    expect(result.trip?.descriptionReason).toBe('vision-cap')
    expect(result.trip?.diary).not.toContain('sk-test-secret')
    expect(urls.some((url) => url.includes('chat/completions'))).toBe(false)
    expect(store.visionCallsOnDay('2026-10-22')).toBe(0)
    store.close()
  })

  it('honours the daily cap unless force is set, and the idle interval', async () => {
    const { travel, store } = setup({
      config: { dailyCap: 1, travelIntervalSeconds: 3600 },
      fetchImpl: async () => imageResponse(jpeg()),
    })
    expect((await travel.travel({ trigger: 'manual', placeId: 'hanko' })).ok).toBe(true)
    const capped = await travel.travel({ trigger: 'idle' })
    expect(capped.code).toBe('daily-cap')
    const forced = await travel.travel({ trigger: 'manual', placeId: 'reykjanes', force: true })
    expect(forced.ok).toBe(true)
    store.close()
  })

  it('reports busy while a trip is in flight and aborts when the signal fires', async () => {
    let release: (() => void) | undefined
    const { travel, store } = setup({
      config: { fetchTimeoutMs: 2000 },
      fetchImpl: (_input, init) => new Promise((resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        if (init?.signal?.aborted) {
          abort()
          return
        }
        init?.signal?.addEventListener('abort', abort, { once: true })
        release = () => resolve(imageResponse(jpeg()))
      }),
    })
    const first = travel.travel({ trigger: 'manual', placeId: 'hanko' })
    for (let i = 0; i < 50 && !release; i += 1) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(release).toBeTypeOf('function')
    const busy = await travel.travel({ trigger: 'manual', placeId: 'hanko' })
    expect(busy.code).toBe('busy')
    release?.()
    expect((await first).ok).toBe(true)

    const controller = new AbortController()
    const aborted = travel.travel({ trigger: 'manual', placeId: 'reykjanes', signal: controller.signal })
    controller.abort()
    expect((await aborted).code).toBe('aborted')
    store.close()
  })

  it('falls back to the curated list when Windy has no usable frame', async () => {
    const urls: string[] = []
    const { travel, store } = setup({
      config: { windyEnabled: true, windyApiKey: 'windy-test-key', windyWeight: 1, maxPlaceAttempts: 1 },
      fetchImpl: async (input) => {
        const url = String(input)
        urls.push(url)
        if (url.includes('api.windy.com')) {
          return new Response(JSON.stringify({
            webcams: [{
              webcamId: 7,
              title: 'Harbour',
              location: { country: 'Iceland', timezone: 'Atlantic/Reykjavik', latitude: 64, longitude: -22 },
              images: { current: { preview: 'https://images-webcams.windy.com/7.jpg' } },
            }],
          }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        if (url.includes('images-webcams.windy.com')) return new Response('gone', { status: 404 })
        return imageResponse(jpeg())
      },
    })
    const result = await travel.travel({ trigger: 'manual' })
    expect(result.ok).toBe(true)
    expect(result.trip?.source).toBe('catalog')
    expect(urls.some((url) => url.includes('api.windy.com'))).toBe(true)
    expect(urls.join('\n')).not.toContain('windy-test-key')
    store.close()
  })

  it('tries the next curated camera after a 304', async () => {
    const urls: string[] = []
    const { travel, store } = setup({
      config: { enabledPlaceIds: ['hanko', 'reykjanes'], maxPlaceAttempts: 2 },
      fetchImpl: async (input) => {
        const url = String(input)
        urls.push(url)
        if (url.includes('digitraffic')) return new Response(null, { status: 304 })
        return imageResponse(jpeg())
      },
    })
    const result = await travel.travel({ trigger: 'manual' })
    expect(result.ok).toBe(true)
    expect(result.trip?.placeId).toBe('reykjanes')
    expect(urls.some((url) => url.includes('digitraffic'))).toBe(true)
    store.close()
  })
})

function setup(options: {
  fetchImpl: typeof fetch
  config?: Record<string, unknown>
}) {
  const dir = tempDir()
  dirs.push(dir)
  const config = loadConfig({
    dataDir: dir,
    quietHoursStart: '00:00',
    quietHoursEnd: '00:00',
    timezone: 'UTC',
    saveImages: true,
    fetchRetries: 0,
    minHostIntervalMs: 0,
    sourceCooldownSeconds: 0,
    ...options.config,
  })
  const store = new TripStore(dir)
  const travel = new TravelService({
    config,
    store,
    fetchImpl: options.fetchImpl,
    resolve: publicResolve,
    now: () => fixed,
    rng: () => 0,
    clock: new ManualClock(),
  })
  return { travel, store, config }
}
