import type { WanderTrip } from './types.js'

export function normalizeEventTime(time: unknown, fallbackMs: number): number {
  if (typeof time !== 'number' || !Number.isFinite(time)) return fallbackMs
  if (time > 0 && time < 1e12) return time * 1000
  return time
}

/** Snapshot of diaries that were already written when this user message arrived. */
export function mentionIdsAt(trips: readonly WanderTrip[], eventTimeMs: number): string[] {
  const ids: string[] = []
  for (const trip of trips) {
    if (trip.mentionedAt) continue
    const at = Date.parse(trip.traveledAt)
    if (Number.isFinite(at) && at <= eventTimeMs) ids.push(trip.id)
  }
  return ids
}

export class MentionTracker {
  readonly #pending = new Map<string, string[]>()

  note(agentKey: string, trips: readonly WanderTrip[], eventTimeMs: number): void {
    this.#pending.set(agentKey, mentionIdsAt(trips, eventTimeMs))
  }

  take(agentKey: string): string[] {
    const ids = this.#pending.get(agentKey) ?? []
    this.#pending.delete(agentKey)
    return ids
  }

  forget(agentKey: string): void {
    this.#pending.delete(agentKey)
  }
}
