import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TripStore } from '../src/store.js'
import type { WanderTrip } from '../src/types.js'
import { removeDir, tempDir } from './helpers.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir)
})

describe('trip store', () => {
  it('round-trips trips, mentions, vision calls, and the JSONL mirror', () => {
    const dir = tempDir()
    dirs.push(dir)
    const store = new TripStore(dir)
    const trip = sample('w_1', 'hanko')
    store.insert(trip)
    expect(store.listRecent(5)).toHaveLength(1)
    expect(store.countOnDay('2026-10-22')).toBe(1)
    expect(store.search('Hanko', 5)[0]?.id).toBe('w_1')
    expect(store.unmentioned().map((item) => item.id)).toEqual(['w_1'])
    store.markMentioned(['w_1'], '2026-10-22T13:00:00.000Z')
    expect(store.unmentioned()).toHaveLength(0)
    expect(store.listRecent(1)[0]?.mentionedAt).toBe('2026-10-22T13:00:00.000Z')
    store.recordVisionCall('2026-10-22', trip.traveledAt, false)
    expect(store.visionCallsOnDay('2026-10-22')).toBe(1)
    store.setSourceState('hanko', '"e"', trip.traveledAt)
    expect(store.cooledIds(3600, Date.parse(trip.traveledAt) + 1000).has('hanko')).toBe(true)
    const trips = readFileSync(path.join(dir, 'trips.jsonl'), 'utf8').trim().split('\n')
    const experiences = readFileSync(path.join(dir, 'experiences.jsonl'), 'utf8').trim().split('\n')
    expect(JSON.parse(trips[0] ?? '{}').id).toBe('w_1')
    expect(JSON.parse(experiences[0] ?? '{}').schemaVersion).toBe(1)
    store.close()
    store.close()
  })
})

function sample(id: string, placeId: string): WanderTrip {
  return {
    id,
    traveledAt: '2026-10-22T12:00:00.000Z',
    dayKey: '2026-10-22',
    placeId,
    placeName: 'Hanko',
    region: 'Uusimaa',
    country: 'Finland',
    timezone: 'Europe/Helsinki',
    latitude: 1,
    longitude: 2,
    source: 'catalog',
    snapshotUrl: 'https://weathercam.digitraffic.fi/C0150701.jpg',
    pageUrl: 'https://www.digitraffic.fi/en/road-traffic/',
    attribution: 'Source: Fintraffic / digitraffic.fi, license CC BY 4.0',
    license: 'CC BY 4.0',
    tosUrl: 'https://www.digitraffic.fi/en/terms-of-service/',
    imagePath: '',
    imageUrl: 'https://weathercam.digitraffic.fi/C0150701.jpg',
    descriptionMode: 'metadata',
    descriptionReason: 'metadata',
    summary: 'Hanko',
    diary: '刚才我去了芬兰看了 Hanko。',
    mood: '',
    mentionedAt: '',
  }
}
