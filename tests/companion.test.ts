import { describe, expect, it } from 'vitest'
import { COMPANION_EXPERIENCE_VERSION, toCompanionExperience, WANDER_TRIP_EVENT } from '../src/companion.js'
import { parseWindyWebcams } from '../src/windy.js'
import type { WanderTrip } from '../src/types.js'

describe('companion export', () => {
  it('maps a trip into a versioned experience', () => {
    const experience = toCompanionExperience(trip)
    expect(WANDER_TRIP_EVENT).toBe('wander/trip')
    expect(experience.schemaVersion).toBe(COMPANION_EXPERIENCE_VERSION)
    expect(experience.source).toBe('dsh-wander')
    expect(experience.text).toBe(trip.diary)
    expect(experience.place.id).toBe('hanko')
    expect(experience.tags).toContain('Finland')
  })

  it('keeps only Windy images on the documented hosts', () => {
    const places = parseWindyWebcams({
      webcams: [
        {
          webcamId: 42,
          title: 'Harbour',
          location: { city: 'Reykjavík', country: 'Iceland', latitude: 64.1, longitude: -21.9, timezone: 'Atlantic/Reykjavik' },
          images: { current: { preview: 'https://images-webcams.windy.com/42.jpg' } },
          urls: { detail: 'https://www.windy.com/webcams/42' },
        },
        {
          webcamId: 99,
          title: 'Hidden',
          location: { country: 'Iceland' },
          images: { current: { preview: 'https://evil.example/cam.jpg' } },
        },
      ],
    })
    expect(places.map((place) => place.id)).toEqual(['windy-42'])
    expect(places[0]?.attribution).toContain('Windy')
    expect(parseWindyWebcams({ result: { webcams: [] } })).toEqual([])
  })
})

const trip: WanderTrip = {
  id: 'w_1',
  traveledAt: '2026-10-22T11:00:00.000Z',
  dayKey: '2026-10-22',
  placeId: 'hanko',
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
  diary: '刚才我去了芬兰。',
  mood: '',
  mentionedAt: '',
}
