import { describe, expect, it } from 'vitest'
import { renderDiarySection, tripsForPrompt } from '../src/prompt.js'
import type { WanderTrip } from '../src/types.js'

describe('prompt diary', () => {
  it('quotes unmentioned diaries and says when the picture was not seen', () => {
    const text = renderDiarySection([sample], 'zh-CN', 3)
    expect(text).toContain('旅途记忆')
    expect(text).toContain('没有看过画面')
    expect(text).toContain(sample.diary)
    expect(renderDiarySection([], 'zh-CN', 3)).toBe('')
  })

  it('drops diaries outside the mention window', () => {
    const now = Date.parse('2026-10-22T12:00:00.000Z')
    const stale = { ...sample, id: 'old', traveledAt: '2026-10-01T00:00:00.000Z' }
    const mentioned = { ...sample, id: 'said', mentionedAt: '2026-10-22T11:00:00.000Z' }
    expect(tripsForPrompt([sample, stale, mentioned], now, 36).map((trip) => trip.id)).toEqual(['w_1'])
  })
})

const sample: WanderTrip = {
  id: 'w_1',
  traveledAt: '2026-10-22T11:00:00.000Z',
  dayKey: '2026-10-22',
  placeId: 'hanko',
  placeName: 'Hanko',
  region: 'Uusimaa',
  country: 'Finland',
  timezone: 'Europe/Helsinki',
  latitude: 0,
  longitude: 0,
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
