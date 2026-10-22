import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { IdleScheduler, isSubagent, nextIdleDelay, type IdleAgent } from '../src/idle.js'
import { mentionIdsAt, MentionTracker } from '../src/mention.js'
import type { TravelResult, WanderTrip } from '../src/types.js'
import { noopLog } from '../src/types.js'

describe('idle trigger', () => {
  it('waits out a fresh session and keeps a short grace for an already-idle one', () => {
    const scheduled: Array<{ id: string; delay: number }> = []
    const scheduler = new IdleScheduler({
      timeout(_callback, delayMs) {
        scheduled.push({ id: scheduled.length === 0 ? 'fresh' : 'resumed', delay: delayMs })
        return () => {}
      },
      on: () => () => {},
      agents: { list: () => [] },
      log: noopLog,
    }, {
      config: loadConfig({}),
      now: () => new Date('2026-10-22T12:00:00Z'),
      travel: async () => ({ ok: true, code: 'ok', message: '' }),
      onIdle() {},
    })
    scheduler.arm(sessionAgent('fresh', []), 'created')
    scheduler.arm(sessionAgent('resumed', [{
      type: 'user/message',
      time: Date.parse('2026-10-21T00:00:00Z'),
      data: { source: { kind: 'user' } },
    }]), 'startup')
    expect(scheduled.find((item) => item.id === 'fresh')?.delay).toBe(1200_000)
    expect(scheduled.find((item) => item.id === 'resumed')?.delay).toBe(15_000)
    scheduler.stop()
  })

  it('disarms and aborts when the agent starts running', async () => {
    const calls: string[] = []
    let signal: AbortSignal | undefined
    const scheduler = new IdleScheduler(hostOf((delay, id) => calls.push(`${id}:${delay}`)), {
      config: loadConfig({ idleSeconds: 5, startupGraceSeconds: 1, travelIntervalSeconds: 60 }),
      now: () => new Date('2026-10-22T12:00:00Z'),
      async travel(_key, next) {
        signal = next
        return { ok: true, code: 'ok', message: '' }
      },
      onIdle() {},
    })
    const agent = sessionAgent('main', [])
    scheduler.arm(agent, 'user-idle')
    expect(isSubagent(sessionAgent('child', [], 'subagent'))).toBe(true)
    scheduler.disarm(agent)
    expect(signal).toBeUndefined()
    scheduler.stop()
  })

  it('re-arms after a successful idle trip and stops after a disable result', async () => {
    const timers: Array<{ delay: number; run: () => void }> = []
    const host = {
      timeout(callback: () => void, delayMs: number) {
        const entry = { delay: delayMs, run: callback }
        timers.push(entry)
        return () => {
          entry.run = () => {}
        }
      },
      on: () => () => {},
      agents: { list: () => [] },
      log: noopLog,
    }
    const results: TravelResult[] = [
      { ok: true, code: 'ok', message: 'went' },
      { ok: false, code: 'disabled', message: 'off', retryAfterMs: 0 },
    ]
    const scheduler = new IdleScheduler(host, {
      config: loadConfig({ idleSeconds: 10, startupGraceSeconds: 0, travelIntervalSeconds: 90 }),
      now: () => new Date('2026-10-22T12:00:00Z'),
      travel: async () => results.shift() ?? { ok: false, code: 'disabled', message: '' },
      onIdle() {},
    })
    const agent = sessionAgent('main', [{ type: 'user/message', time: Date.parse('2026-10-22T11:59:50Z'), data: { source: { kind: 'user' } } }])
    scheduler.arm(agent, 'user-idle')
    expect(timers[0]?.delay).toBe(0)
    timers[0]?.run()
    await flush()
    expect(timers[1]?.delay).toBe(90_000)
    timers[1]?.run()
    await flush()
    expect(timers).toHaveLength(2)
    scheduler.stop()
  })

  it('snapshots only diaries written before the user message', () => {
    const early = tripAt('w_early', '2026-10-22T10:00:00.000Z')
    const later = tripAt('w_later', '2026-10-22T12:00:00.000Z')
    const tracker = new MentionTracker()
    tracker.note('agent', [early, later], Date.parse('2026-10-22T11:00:00.000Z'))
    expect(mentionIdsAt([early, later], Date.parse('2026-10-22T11:00:00.000Z'))).toEqual(['w_early'])
    expect(tracker.take('agent')).toEqual(['w_early'])
    expect(tracker.take('agent')).toEqual([])
  })

  it('turns policy results into the next idle delay', () => {
    expect(nextIdleDelay({ ok: true, code: 'ok', message: '' }, 90)).toBe(90_000)
    expect(nextIdleDelay({ ok: false, code: 'sources-failed', message: '' }, 60)).toBe(5 * 60_000)
    expect(nextIdleDelay({ ok: false, code: 'quiet', message: '', retryAfterMs: 120_000 }, 90)).toBe(120_000)
    expect(nextIdleDelay({ ok: false, code: 'aborted', message: '' }, 90)).toBeUndefined()
  })
})

function hostOf(onTimeout: (delay: number, id: string) => void) {
  return {
    timeout(callback: () => void, delayMs: number) {
      onTimeout(delayMs, 'x')
      void callback
      return () => {}
    },
    on: () => () => {},
    agents: { list: () => [] as IdleAgent[] },
    log: noopLog,
  }
}

function sessionAgent(id: string, events: IdleAgent['session'] extends { snapshotEvents?: () => infer E } ? E : never, origin?: string): IdleAgent {
  return {
    status: 'idle',
    session: {
      id,
      header: origin ? { origin } : {},
      snapshotEvents: () => events,
    },
  }
}

function tripAt(id: string, traveledAt: string): WanderTrip {
  return {
    id,
    traveledAt,
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
    pageUrl: 'https://example.com',
    attribution: 'attr',
    license: 'CC BY 4.0',
    tosUrl: 'https://example.com',
    imagePath: '',
    imageUrl: '',
    descriptionMode: 'metadata',
    descriptionReason: 'metadata',
    summary: '',
    diary: 'diary',
    mood: '',
    mentionedAt: '',
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
