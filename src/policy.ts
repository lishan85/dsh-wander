import { MAX_TIMER_DELAY_MS } from './constants.js'
import { WanderError } from './errors.js'
import type { DiaryLanguage } from './types.js'

export interface ClockParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const CLOCK = /^(\d{2}):(\d{2})$/

export function parseClock(value: string): { hour: number; minute: number } {
  const match = CLOCK.exec(value)
  if (!match) throw new WanderError('config', `quiet hours must be HH:MM, received ${value}`)
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) {
    throw new WanderError('config', `quiet hours must be a real time of day, received ${value}`)
  }
  return { hour, minute }
}

export function assertTimezone(value: string): void {
  if (!value) return
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
  } catch {
    throw new WanderError('config', `unknown IANA timezone ${value}`)
  }
}

export function resolveTimezone(configured: string): string {
  if (configured) return configured
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

export function zonedParts(date: Date, timeZone: string): ClockParts {
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes) => {
    const part = formatted.find((item) => item.type === type)
    return part ? Number(part.value) : Number.NaN
  }
  let hour = read('hour')
  if (hour === 24) hour = 0
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
  }
}

export function dayKey(date: Date, timeZone: string): string {
  const parts = zonedParts(date, timeZone)
  const month = String(parts.month).padStart(2, '0')
  const day = String(parts.day).padStart(2, '0')
  return `${parts.year}-${month}-${day}`
}

export function minutesOfDay(hour: number, minute: number): number {
  return hour * 60 + minute
}

export function isQuiet(date: Date, start: string, end: string, timeZone: string): boolean {
  const startMin = clockMinutes(start)
  const endMin = clockMinutes(end)
  if (startMin === endMin) return false
  const parts = zonedParts(date, timeZone)
  const nowMin = minutesOfDay(parts.hour, parts.minute)
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin
  return nowMin >= startMin || nowMin < endMin
}

export function msUntilQuietEnd(date: Date, start: string, end: string, timeZone: string): number {
  if (!isQuiet(date, start, end, timeZone)) return 0
  const limit = 36 * 60
  for (let step = 1; step <= limit; step += 1) {
    const next = new Date(date.getTime() + step * 60_000)
    if (!isQuiet(next, start, end, timeZone)) return step * 60_000
  }
  return limit * 60_000
}

export function msUntilNextLocalMidnight(date: Date, timeZone: string): number {
  const key = dayKey(date, timeZone)
  const limit = 36 * 60
  for (let step = 1; step <= limit; step += 1) {
    const next = new Date(date.getTime() + step * 60_000)
    if (dayKey(next, timeZone) !== key) return step * 60_000
  }
  return limit * 60_000
}

export function capDelay(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0
  return Math.min(Math.floor(ms), MAX_TIMER_DELAY_MS)
}

export type TimeOfDay =
  | '清晨'
  | '上午'
  | '中午'
  | '下午'
  | '傍晚'
  | '晚上'
  | '深夜'

export function timeOfDay(date: Date, timeZone: string): TimeOfDay {
  const hour = zonedParts(date, timeZone).hour
  if (hour >= 5 && hour < 8) return '清晨'
  if (hour >= 8 && hour < 11) return '上午'
  if (hour >= 11 && hour < 13) return '中午'
  if (hour >= 13 && hour < 17) return '下午'
  if (hour >= 17 && hour < 19) return '傍晚'
  if (hour >= 19 && hour < 23) return '晚上'
  return '深夜'
}

export function timeOfDayLabel(bucket: TimeOfDay, language: DiaryLanguage): string {
  if (language === 'zh-CN') return bucket
  switch (bucket) {
    case '清晨':
      return 'early morning'
    case '上午':
      return 'morning'
    case '中午':
      return 'midday'
    case '下午':
      return 'afternoon'
    case '傍晚':
      return 'early evening'
    case '晚上':
      return 'evening'
    case '深夜':
      return 'late night'
  }
}

export interface TravelAssessmentInput {
  now: Date
  timeZone: string
  quietStart: string
  quietEnd: string
  dailyCap: number
  todayCount: number
  lastTripAt: Date | undefined
  travelIntervalSeconds: number
  manual: boolean
  force: boolean
  enabled: boolean
}

export interface TravelDenial {
  code: 'disabled' | 'quiet' | 'daily-cap' | 'interval'
  message: string
  retryAfterMs: number
}

/** Policy gate. Manual trips skip quiet hours and the interval. `force` skips only the daily cap. */
export function assessTravel(input: TravelAssessmentInput): TravelDenial | undefined {
  if (!input.enabled) {
    return { code: 'disabled', message: 'dsh-wander is disabled', retryAfterMs: 0 }
  }
  if (!input.manual && isQuiet(input.now, input.quietStart, input.quietEnd, input.timeZone)) {
    const retryAfterMs = msUntilQuietEnd(input.now, input.quietStart, input.quietEnd, input.timeZone)
    return {
      code: 'quiet',
      message: 'quiet hours',
      retryAfterMs: Math.max(retryAfterMs, 60_000),
    }
  }
  if (!input.force && input.todayCount >= input.dailyCap) {
    return {
      code: 'daily-cap',
      message: 'daily trip cap reached',
      retryAfterMs: Math.max(msUntilNextLocalMidnight(input.now, input.timeZone), 60_000),
    }
  }
  if (!input.manual && input.lastTripAt) {
    const elapsed = input.now.getTime() - input.lastTripAt.getTime()
    const intervalMs = input.travelIntervalSeconds * 1000
    if (elapsed < intervalMs) {
      return {
        code: 'interval',
        message: 'travel interval has not elapsed',
        retryAfterMs: Math.max(intervalMs - elapsed, 1000),
      }
    }
  }
  return undefined
}

export function firstIdleDelayMs(options: {
  reason: 'startup' | 'created' | 'user-idle'
  nowMs: number
  lastUserMs?: number
  idleSeconds: number
  startupGraceSeconds: number
}): number {
  const idleMs = options.idleSeconds * 1000
  const last = options.lastUserMs
  if (options.reason === 'startup') {
    const idleFor = last === undefined ? 0 : Math.max(0, options.nowMs - last)
    const remaining = Math.max(0, idleMs - idleFor)
    const grace = options.startupGraceSeconds * 1000
    return capDelay(Math.max(remaining, grace))
  }
  if (last === undefined) return capDelay(idleMs)
  const elapsed = Math.max(0, options.nowMs - last)
  return capDelay(Math.max(0, idleMs - elapsed))
}

function clockMinutes(value: string): number {
  const clock = parseClock(value)
  return minutesOfDay(clock.hour, clock.minute)
}
