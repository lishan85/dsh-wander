import { describe, expect, it } from 'vitest'
import { CATALOG } from '../src/catalog.js'
import { selectPlaces } from '../src/select.js'
import type { Place } from '../src/types.js'

const hanko = place('hanko', 'Finland')
const reykjanes = place('reykjanes', 'Iceland')
const tofino = place('tofino', 'Canada')

describe('destination selection', () => {
  it('avoids the place just visited when another is available', () => {
    const [picked] = selectPlaces({
      places: [hanko, reykjanes],
      lastPlaceId: 'hanko',
      lastCountry: 'Finland',
      recentPlaceIds: ['hanko'],
      cooledIds: new Set(),
      limit: 1,
      rng: () => 0,
    })
    expect(picked?.id).toBe('reykjanes')
  })

  it('skips cameras on cooldown unless every camera is cooling down', () => {
    const cooled = selectPlaces({
      places: [hanko, reykjanes, tofino],
      recentPlaceIds: [],
      cooledIds: new Set(['hanko', 'reykjanes']),
      limit: 1,
      rng: () => 0,
    })
    expect(cooled[0]?.id).toBe('tofino')
    const allCooled = selectPlaces({
      places: [hanko, reykjanes],
      recentPlaceIds: [],
      cooledIds: new Set(['hanko', 'reykjanes']),
      limit: 1,
      rng: () => 0,
    })
    expect(allCooled[0]?.id).toBe('hanko')
  })

  it('stays on a requested place even when that place is cooling down', () => {
    const picked = selectPlaces({
      places: [hanko, reykjanes],
      preferredId: 'Hanko',
      recentPlaceIds: [],
      cooledIds: new Set(['hanko']),
      limit: 3,
      rng: () => 0,
    })
    expect(picked.map((item) => item.id)).toEqual(['hanko'])
  })

  it('lists fifteen curated https cameras on their own hosts', () => {
    expect(CATALOG).toHaveLength(15)
    const ids = new Set(CATALOG.map((item) => item.id))
    expect(ids.size).toBe(15)
    for (const item of CATALOG) {
      const url = new URL(item.snapshotUrl)
      expect(url.protocol).toBe('https:')
      expect(item.allowedHosts.map((host) => host.toLowerCase())).toContain(url.hostname.toLowerCase())
      expect(item.attribution.length).toBeGreaterThan(0)
      expect(item.tosUrl.startsWith('https://')).toBe(true)
    }
  })
})

function place(id: string, country: string): Place {
  return {
    id,
    name: id,
    region: '',
    country,
    timezone: 'UTC',
    latitude: 0,
    longitude: 0,
    snapshotUrl: `https://example.com/${id}.jpg`,
    pageUrl: 'https://example.com',
    attribution: 'test',
    license: 'test',
    tosUrl: 'https://example.com/tos',
    allowedHosts: ['example.com'],
    source: 'catalog',
  }
}
