import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { WanderError } from '../src/errors.js'

describe('config', () => {
  it('fills defaults for an empty object', () => {
    const config = loadConfig({})
    expect(config.enabled).toBe(true)
    expect(config.idleSeconds).toBe(1200)
    expect(config.travelIntervalSeconds).toBe(10800)
    expect(config.visionProvider).toBe('metadata')
    expect(config.diaryLanguage).toBe('zh-CN')
    expect(config.windyEnabled).toBe(false)
    expect(config.dailyCap).toBe(4)
    expect(config.dataDir.endsWith('wander')).toBe(true)
  })

  it('rejects unknown places, bad timezones, and unsafe extra cameras', () => {
    expect(() => loadConfig({ enabledPlaceIds: ['nope'] })).toThrow(WanderError)
    expect(() => loadConfig({ timezone: 'Not/AZone' })).toThrow(/timezone/i)
    expect(() => loadConfig({ quietHoursStart: '24:00' })).toThrow(WanderError)
    expect(() => loadConfig({
      extraPlaces: [{
        id: 'backyard',
        name: 'Backyard',
        country: 'Finland',
        timezone: 'Europe/Helsinki',
        latitude: 60,
        longitude: 25,
        snapshotUrl: 'http://weathercam.digitraffic.fi/x.jpg',
        pageUrl: 'https://www.digitraffic.fi/en/road-traffic/',
        attribution: 'Source',
        license: 'CC BY 4.0',
        tosUrl: 'https://www.digitraffic.fi/en/terms-of-service/',
      }],
    })).toThrow(/https/)
    expect(() => loadConfig({
      extraPlaces: [{
        id: 'hanko',
        name: 'Hanko',
        country: 'Finland',
        timezone: 'Europe/Helsinki',
        latitude: 60,
        longitude: 25,
        snapshotUrl: 'https://weathercam.digitraffic.fi/x.jpg',
        pageUrl: 'https://www.digitraffic.fi/en/road-traffic/',
        attribution: 'Source',
        license: 'CC BY 4.0',
        tosUrl: 'https://www.digitraffic.fi/en/terms-of-service/',
      }],
    })).toThrow(/collides/)
    expect(() => loadConfig({ visionProvider: 'openai', visionBaseUrl: 'http://127.0.0.1/v1' })).toThrow(/https/)
  })

  it('accepts a documented extra public camera', () => {
    const config = loadConfig({
      extraPlaces: [{
        id: 'custom-bridge',
        name: 'Bridge',
        region: 'Test',
        country: 'Finland',
        timezone: 'Europe/Helsinki',
        latitude: 60,
        longitude: 25,
        snapshotUrl: 'https://weathercam.digitraffic.fi/C0150701.jpg',
        pageUrl: 'https://www.digitraffic.fi/en/road-traffic/',
        attribution: 'Source: Fintraffic / digitraffic.fi, license CC BY 4.0',
        license: 'CC BY 4.0',
        tosUrl: 'https://www.digitraffic.fi/en/terms-of-service/',
      }],
    })
    expect(config.extraPlaces[0]?.id).toBe('custom-bridge')
  })
})
