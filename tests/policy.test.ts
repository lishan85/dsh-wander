import { describe, expect, it } from 'vitest'
import { MAX_TIMER_DELAY_MS } from '../src/constants.js'
import {
  assessTravel,
  capDelay,
  dayKey,
  firstIdleDelayMs,
  isQuiet,
  msUntilNextLocalMidnight,
  msUntilQuietEnd,
  timeOfDay,
} from '../src/policy.js'

const zone = 'UTC'

describe('quiet hours and caps', () => {
  it('treats an overnight window as quiet only inside it', () => {
    expect(isQuiet(new Date('2026-10-22T23:30:00Z'), '23:00', '07:00', zone)).toBe(true)
    expect(isQuiet(new Date('2026-10-22T06:59:00Z'), '23:00', '07:00', zone)).toBe(true)
    expect(isQuiet(new Date('2026-10-22T07:00:00Z'), '23:00', '07:00', zone)).toBe(false)
    expect(isQuiet(new Date('2026-10-22T22:59:00Z'), '23:00', '07:00', zone)).toBe(false)
  })

  it('disables quiet hours when the two clocks match', () => {
    expect(isQuiet(new Date('2026-10-22T23:30:00Z'), '00:00', '00:00', zone)).toBe(false)
  })

  it('uses the configured zone for the local day', () => {
    const instant = new Date('2026-10-22T16:30:00Z')
    expect(dayKey(instant, 'UTC')).toBe('2026-10-22')
    expect(dayKey(instant, 'Asia/Shanghai')).toBe('2026-10-23')
    expect(isQuiet(new Date('2026-10-22T15:30:00Z'), '23:00', '07:00', 'Asia/Shanghai')).toBe(true)
  })

  it('waits until quiet hours end and until the next local midnight', () => {
    const at = new Date('2026-10-22T23:30:00Z')
    expect(msUntilQuietEnd(at, '23:00', '07:00', zone)).toBe(7.5 * 60 * 60_000)
    expect(msUntilNextLocalMidnight(at, zone)).toBe(30 * 60_000)
    expect(msUntilQuietEnd(new Date('2026-10-22T12:00:00Z'), '23:00', '07:00', zone)).toBe(0)
  })

  it('caps timer delays at the platform maximum', () => {
    expect(capDelay(3e12)).toBe(MAX_TIMER_DELAY_MS)
    expect(capDelay(-5)).toBe(0)
  })

  it('blocks idle trips for quiet hours, the daily cap, and the interval', () => {
    const now = new Date('2026-10-22T23:30:00Z')
    expect(assessTravel(base(now, { manual: false }))?.code).toBe('quiet')
    expect(assessTravel(base(now, { manual: true }))).toBeUndefined()
    const noon = new Date('2026-10-22T12:00:00Z')
    expect(assessTravel(base(noon, { todayCount: 4 }))?.code).toBe('daily-cap')
    expect(assessTravel(base(noon, { todayCount: 4, force: true }))).toBeUndefined()
    expect(assessTravel(base(noon, { dailyCap: 0 }))?.code).toBe('daily-cap')
    expect(assessTravel(base(noon, {
      lastTripAt: new Date(noon.getTime() - 60_000),
      travelIntervalSeconds: 120,
    }))?.code).toBe('interval')
    expect(assessTravel(base(noon, {
      manual: true,
      lastTripAt: new Date(noon.getTime() - 60_000),
    }))).toBeUndefined()
  })

  it('keeps a startup grace when an already-idle session is resumed', () => {
    const now = 1_000_000
    expect(firstIdleDelayMs({
      reason: 'startup',
      nowMs: now,
      lastUserMs: now - 86_400_000,
      idleSeconds: 60,
      startupGraceSeconds: 15,
    })).toBe(15_000)
    expect(firstIdleDelayMs({
      reason: 'created',
      nowMs: now,
      idleSeconds: 60,
      startupGraceSeconds: 15,
    })).toBe(60_000)
    expect(firstIdleDelayMs({
      reason: 'user-idle',
      nowMs: now,
      lastUserMs: now - 10_000,
      idleSeconds: 60,
      startupGraceSeconds: 15,
    })).toBe(50_000)
  })

  it('names the local time of day without claiming weather', () => {
    expect(timeOfDay(new Date('2026-10-22T05:00:00Z'), zone)).toBe('清晨')
    expect(timeOfDay(new Date('2026-10-22T08:00:00Z'), zone)).toBe('上午')
    expect(timeOfDay(new Date('2026-10-22T11:00:00Z'), zone)).toBe('中午')
    expect(timeOfDay(new Date('2026-10-22T13:00:00Z'), zone)).toBe('下午')
    expect(timeOfDay(new Date('2026-10-22T17:00:00Z'), zone)).toBe('傍晚')
    expect(timeOfDay(new Date('2026-10-22T19:00:00Z'), zone)).toBe('晚上')
    expect(timeOfDay(new Date('2026-10-22T23:00:00Z'), zone)).toBe('深夜')
    expect(timeOfDay(new Date('2026-10-22T04:00:00Z'), zone)).toBe('深夜')
  })
})

function base(now: Date, extra: Record<string, unknown> = {}) {
  return {
    now,
    timeZone: zone,
    quietStart: '23:00',
    quietEnd: '07:00',
    dailyCap: 4,
    todayCount: 0,
    lastTripAt: undefined,
    travelIntervalSeconds: 10800,
    manual: false,
    force: false,
    enabled: true,
    ...extra,
  }
}
