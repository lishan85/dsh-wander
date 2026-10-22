import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { TripStore } from '../src/store.js'
import { TravelService } from '../src/travel.js'
import { removeDir, tempDir } from './helpers.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir)
})

describe('public snapshot', () => {
  it('fetches a real Digitraffic JPEG and writes a metadata diary', async () => {
    const dir = tempDir()
    dirs.push(dir)
    const store = new TripStore(dir)
    const travel = new TravelService({
      config: loadConfig({
        dataDir: dir,
        timezone: 'UTC',
        quietHoursStart: '00:00',
        quietHoursEnd: '00:00',
        visionProvider: 'metadata',
        saveImages: true,
        fetchRetries: 1,
        minHostIntervalMs: 0,
        fetchTimeoutMs: 20_000,
      }),
      store,
    })
    const result = await travel.travel({ trigger: 'manual', placeId: 'hanko' })
    expect(result.ok, result.message).toBe(true)
    expect(result.trip?.descriptionMode).toBe('metadata')
    expect(result.trip?.diary).toContain('没有交给视觉模型')
    expect(result.trip?.attribution).toContain('Fintraffic')
    const bytes = readFileSync(result.trip?.imagePath ?? '')
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1]).toBe(0xd8)
    expect(bytes.byteLength).toBeGreaterThan(256)
    store.close()
  }, 40_000)
})
