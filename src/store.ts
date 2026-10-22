import { mkdirSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { toCompanionExperience } from './companion.js'
import { errorText } from './errors.js'
import type { Log, WanderTrip } from './types.js'
import { noopLog } from './types.js'

interface TripRow {
  json: string
}

export class TripStore {
  readonly dataDir: string
  readonly #db: DatabaseSync
  readonly #log: Log
  #closed = false

  constructor(dataDir: string, log: Log = noopLog) {
    this.dataDir = dataDir
    this.#log = log
    mkdirSync(dataDir, { recursive: true })
    mkdirSync(path.join(dataDir, 'images'), { recursive: true })
    this.#db = new DatabaseSync(path.join(dataDir, 'wander.sqlite'))
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS trips (
        id TEXT PRIMARY KEY,
        traveled_at TEXT NOT NULL,
        day_key TEXT NOT NULL,
        place_id TEXT NOT NULL,
        country TEXT NOT NULL,
        mentioned_at TEXT,
        json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS trips_day ON trips(day_key);
      CREATE INDEX IF NOT EXISTS trips_time ON trips(traveled_at);
      CREATE TABLE IF NOT EXISTS vision_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at TEXT NOT NULL,
        day_key TEXT NOT NULL,
        ok INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_state (
        place_id TEXT PRIMARY KEY,
        etag TEXT,
        fetched_at TEXT
      );
    `)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#db.close()
  }

  insert(trip: WanderTrip): void {
    this.#db.prepare(`
      INSERT INTO trips (id, traveled_at, day_key, place_id, country, mentioned_at, json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      trip.id,
      trip.traveledAt,
      trip.dayKey,
      trip.placeId,
      trip.country,
      trip.mentionedAt || null,
      JSON.stringify(trip),
    )
    this.#mirror(trip)
  }

  listRecent(limit: number): WanderTrip[] {
    const rows = this.#db.prepare(`
      SELECT json FROM trips ORDER BY traveled_at DESC LIMIT ?
    `).all(limit) as unknown as TripRow[]
    return rows.map((row) => this.#parse(row.json)).filter((trip): trip is WanderTrip => trip !== undefined)
  }

  search(query: string, limit: number): WanderTrip[] {
    const needle = query.trim().toLowerCase()
    if (!needle) return this.listRecent(limit)
    const like = `%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
    const rows = this.#db.prepare(`
      SELECT json FROM trips
      WHERE lower(json) LIKE ? ESCAPE '\\'
      ORDER BY traveled_at DESC
      LIMIT ?
    `).all(like, limit) as unknown as TripRow[]
    return rows.map((row) => this.#parse(row.json)).filter((trip): trip is WanderTrip => trip !== undefined)
  }

  unmentioned(): WanderTrip[] {
    const rows = this.#db.prepare(`
      SELECT json FROM trips WHERE mentioned_at IS NULL ORDER BY traveled_at DESC
    `).all() as unknown as TripRow[]
    return rows.map((row) => this.#parse(row.json)).filter((trip): trip is WanderTrip => trip !== undefined)
  }

  markMentioned(ids: readonly string[], at: string): void {
    if (ids.length === 0) return
    const update = this.#db.prepare('UPDATE trips SET mentioned_at = ?, json = ? WHERE id = ?')
    for (const id of ids) {
      const row = this.#db.prepare('SELECT json FROM trips WHERE id = ?').get(id) as TripRow | undefined
      const trip = row ? this.#parse(row.json) : undefined
      if (!trip || trip.mentionedAt) continue
      trip.mentionedAt = at
      update.run(at, JSON.stringify(trip), id)
    }
  }

  countOnDay(dayKey: string): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS n FROM trips WHERE day_key = ?').get(dayKey) as { n: number } | undefined
    return row?.n ?? 0
  }

  lastTrip(): WanderTrip | undefined {
    return this.listRecent(1)[0]
  }

  recentPlaceIds(limit: number, sinceMs: number): string[] {
    const rows = this.#db.prepare(`
      SELECT place_id, traveled_at FROM trips ORDER BY traveled_at DESC LIMIT ?
    `).all(Math.max(limit, 1)) as unknown as Array<{ place_id: string; traveled_at: string }>
    const ids: string[] = []
    for (const row of rows) {
      if (Date.parse(row.traveled_at) < sinceMs) continue
      if (!ids.includes(row.place_id)) ids.push(row.place_id)
      if (ids.length >= limit) break
    }
    return ids
  }

  visionCallsOnDay(dayKey: string): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS n FROM vision_calls WHERE day_key = ?').get(dayKey) as { n: number } | undefined
    return row?.n ?? 0
  }

  recordVisionCall(dayKey: string, at: string, ok: boolean): void {
    this.#db.prepare('INSERT INTO vision_calls (at, day_key, ok) VALUES (?, ?, ?)').run(at, dayKey, ok ? 1 : 0)
  }

  sourceState(placeId: string): { etag: string; fetchedAt: string } | undefined {
    const row = this.#db.prepare('SELECT etag, fetched_at FROM source_state WHERE place_id = ?').get(placeId) as
      | { etag: string | null; fetched_at: string | null }
      | undefined
    if (!row?.fetched_at) return undefined
    return { etag: row.etag ?? '', fetchedAt: row.fetched_at }
  }

  setSourceState(placeId: string, etag: string, fetchedAt: string): void {
    this.#db.prepare(`
      INSERT INTO source_state (place_id, etag, fetched_at) VALUES (?, ?, ?)
      ON CONFLICT(place_id) DO UPDATE SET etag = excluded.etag, fetched_at = excluded.fetched_at
    `).run(placeId, etag, fetchedAt)
  }

  cooledIds(cooldownSeconds: number, nowMs: number): Set<string> {
    const rows = this.#db.prepare('SELECT place_id, fetched_at FROM source_state').all() as unknown as Array<{
      place_id: string
      fetched_at: string | null
    }>
    const cooled = new Set<string>()
    for (const row of rows) {
      if (!row.fetched_at) continue
      if (nowMs - Date.parse(row.fetched_at) < cooldownSeconds * 1000) cooled.add(row.place_id)
    }
    return cooled
  }

  #parse(json: string): WanderTrip | undefined {
    try {
      const value = JSON.parse(json) as WanderTrip
      if (!value || typeof value.id !== 'string') return undefined
      return value
    } catch (error) {
      this.#log.warn(`skipped a corrupt trip row: ${errorText(error)}`)
      return undefined
    }
  }

  #mirror(trip: WanderTrip): void {
    try {
      appendFileSync(path.join(this.dataDir, 'trips.jsonl'), `${JSON.stringify(trip)}\n`)
      appendFileSync(path.join(this.dataDir, 'experiences.jsonl'), `${JSON.stringify(toCompanionExperience(trip))}\n`)
    } catch (error) {
      this.#log.warn(`trip ${trip.id} is stored, but the JSONL mirror failed: ${errorText(error)}`)
    }
  }
}
