import { randomUUID } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { systemClock } from './clock.js'
import { findPlace, resolvePlaces } from './catalog.js'
import { toCompanionExperience } from './companion.js'
import { abortError, errorText, isAbort, redact } from './errors.js'
import { fetchSnapshot, HostLimiter, type HostResolver } from './net.js'
import { assessTravel, dayKey, resolveTimezone } from './policy.js'
import { selectPlaces } from './select.js'
import type { TripStore } from './store.js'
import type { Clock, Log, Place, TravelRequest, TravelResult, WanderConfig, WanderTrip } from './types.js'
import { noopLog } from './types.js'
import { describeImage } from './vision.js'
import { fetchWindyPlaces } from './windy.js'

export interface TravelDeps {
  config: WanderConfig
  store: TripStore
  fetchImpl?: typeof fetch
  resolve?: HostResolver
  now?: () => Date
  rng?: () => number
  clock?: Clock
  log?: Log
  emit?: (experience: ReturnType<typeof toCompanionExperience>) => void
  limiter?: HostLimiter
}

export class TravelService {
  readonly #deps: TravelDeps
  readonly #limiter: HostLimiter
  readonly #log: Log
  #busy = false

  constructor(deps: TravelDeps) {
    this.#deps = deps
    this.#log = deps.log ?? noopLog
    this.#limiter = deps.limiter ?? new HostLimiter(deps.clock ?? systemClock)
  }

  get busy(): boolean {
    return this.#busy
  }

  async travel(request: TravelRequest): Promise<TravelResult> {
    if (this.#busy) return { ok: false, code: 'busy', message: 'a trip is already in progress' }
    this.#busy = true
    const secret = this.#deps.config.visionApiKey || this.#deps.config.windyApiKey
    try {
      return await this.#go(request)
    } catch (error) {
      if (isAbort(error) || request.signal?.aborted) {
        return { ok: false, code: 'aborted', message: 'the trip was aborted' }
      }
      const message = redact(errorText(error), secret)
      this.#log.warn(`wander trip failed: ${message}`)
      return { ok: false, code: 'error', message, retryAfterMs: 60_000 }
    } finally {
      this.#busy = false
    }
  }

  async #go(request: TravelRequest): Promise<TravelResult> {
    if (request.signal?.aborted) return { ok: false, code: 'aborted', message: 'the trip was aborted' }
    const config = this.#deps.config
    const now = (this.#deps.now ?? (() => new Date()))()
    const timeZone = resolveTimezone(config.timezone)
    const today = dayKey(now, timeZone)
    const last = this.#deps.store.lastTrip()
    const denial = assessTravel({
      now,
      timeZone,
      quietStart: config.quietHoursStart,
      quietEnd: config.quietHoursEnd,
      dailyCap: config.dailyCap,
      todayCount: this.#deps.store.countOnDay(today),
      lastTripAt: last ? new Date(last.traveledAt) : undefined,
      travelIntervalSeconds: config.travelIntervalSeconds,
      manual: request.trigger === 'manual',
      force: request.force === true,
      enabled: config.enabled,
    })
    if (denial) return { ok: false, ...denial }
    const curated = resolvePlaces(config)
    if (request.placeId) {
      const place = findPlace(curated, request.placeId)
      if (!place) {
        return { ok: false, code: 'unknown-place', message: `unknown or disabled place ${request.placeId}` }
      }
      const result = await this.#attempt([place], [place], now, timeZone, today, request.signal)
      if (result?.ok || result?.code === 'aborted') return result
      return this.#exhausted(result?.message ?? 'that camera could not be fetched')
    }
    const rng = this.#deps.rng ?? Math.random
    const allowWindy = config.windyEnabled && config.windyApiKey !== '' && config.enabledPlaceIds.length === 0
    if (allowWindy && rng() < config.windyWeight) {
      try {
        const windy = await fetchWindyPlaces({
          apiKey: config.windyApiKey,
          rng,
          fetchImpl: this.#deps.fetchImpl,
          signal: request.signal,
          timeoutMs: config.fetchTimeoutMs,
        })
        if (windy.length > 0) {
          const result = await this.#attempt(windy, undefined, now, timeZone, today, request.signal)
          if (result?.ok || result?.code === 'aborted') return result
          this.#log.warn('Windy cameras were unavailable; falling back to the curated list')
        }
      } catch (error) {
        if (isAbort(error) || request.signal?.aborted) throw error
        this.#log.warn(`Windy list failed: ${redact(errorText(error), config.windyApiKey)}`)
      }
    }
    const result = await this.#attempt(curated, undefined, now, timeZone, today, request.signal)
    if (result?.ok || result?.code === 'aborted') return result
    return this.#exhausted(result?.message ?? 'no public camera could be fetched')
  }

  async #attempt(
    places: readonly Place[],
    chosen: readonly Place[] | undefined,
    now: Date,
    timeZone: string,
    today: string,
    signal?: AbortSignal,
  ): Promise<TravelResult | undefined> {
    const config = this.#deps.config
    const rng = this.#deps.rng ?? Math.random
    const last = this.#deps.store.lastTrip()
    const since = now.getTime() - config.repeatPlaceHours * 3_600_000
    const picks = chosen ?? selectPlaces({
      places,
      lastPlaceId: last?.placeId,
      lastCountry: last?.country,
      recentPlaceIds: this.#deps.store.recentPlaceIds(config.avoidRecentPlaces, since),
      cooledIds: this.#deps.store.cooledIds(config.sourceCooldownSeconds, now.getTime()),
      limit: config.maxPlaceAttempts,
      rng,
    })
    let lastMessage = 'no public camera could be fetched'
    for (const place of picks) {
      if (signal?.aborted) return { ok: false, code: 'aborted', message: 'the trip was aborted' }
      const outcome = await this.#visit(place, now, timeZone, today, signal)
      if (outcome.kind === 'trip') return outcome.result
      lastMessage = outcome.message
    }
    if (picks.length === 0) return undefined
    return { ok: false, code: 'skipped', message: lastMessage }
  }

  async #visit(
    place: Place,
    now: Date,
    timeZone: string,
    today: string,
    signal?: AbortSignal,
  ): Promise<{ kind: 'trip'; result: TravelResult } | { kind: 'skip'; message: string }> {
    const config = this.#deps.config
    const previous = this.#deps.store.sourceState(place.id)
    const fetched = await fetchSnapshot({
      url: place.snapshotUrl,
      allowedHosts: place.allowedHosts,
      headers: place.headers,
      etag: previous?.etag,
      timeoutMs: config.fetchTimeoutMs,
      retries: config.fetchRetries,
      maxBytes: config.maxImageBytes,
      minHostIntervalMs: config.minHostIntervalMs,
      limiter: this.#limiter,
      fetchImpl: this.#deps.fetchImpl,
      resolve: this.#deps.resolve,
      signal,
      clock: this.#deps.clock,
    })
    if (!fetched.ok) {
      if (fetched.code !== 'network') {
        this.#deps.store.setSourceState(
          place.id,
          fetched.code === 'not-modified' ? (previous?.etag ?? '') : '',
          now.toISOString(),
        )
      }
      return { kind: 'skip', message: fetched.message }
    }
    this.#deps.store.setSourceState(place.id, fetched.etag, now.toISOString())
    const description = await describeImage({
      config,
      place,
      bytes: fetched.bytes,
      mediaType: fetched.mediaType,
      now,
      visionCallsToday: this.#deps.store.visionCallsOnDay(today),
      consumeVisionCall: () => {
        if (this.#deps.store.visionCallsOnDay(today) >= config.maxVisionCallsPerDay) return false
        this.#deps.store.recordVisionCall(today, now.toISOString(), false)
        return true
      },
      fetchImpl: this.#deps.fetchImpl,
      signal,
      onError: (message) => this.#log.warn(`vision fallback: ${message}`),
    })
    if (signal?.aborted) throw abortError()
    const id = `w_${randomUUID().replace(/-/g, '')}`
    let imagePath = ''
    if (config.saveImages) {
      imagePath = path.join(this.#deps.store.dataDir, 'images', `${id}.${fetched.ext}`)
      try {
        writeFileSync(imagePath, fetched.bytes)
      } catch (error) {
        this.#log.warn(`could not save snapshot: ${errorText(error)}`)
        imagePath = ''
      }
    }
    const trip: WanderTrip = {
      id,
      traveledAt: now.toISOString(),
      dayKey: today,
      placeId: place.id,
      placeName: place.name,
      region: place.region,
      country: place.country,
      timezone: place.timezone,
      latitude: place.latitude,
      longitude: place.longitude,
      source: place.source,
      snapshotUrl: place.snapshotUrl,
      pageUrl: place.pageUrl,
      attribution: place.attribution,
      license: place.license,
      tosUrl: place.tosUrl,
      imagePath,
      imageUrl: fetched.finalUrl,
      descriptionMode: description.mode,
      descriptionReason: description.reason,
      summary: description.summary,
      diary: description.diary,
      mood: description.mood,
      mentionedAt: '',
    }
    try {
      this.#deps.store.insert(trip)
    } catch (error) {
      if (imagePath) {
        try {
          unlinkSync(imagePath)
        } catch {
          // The trip row was not stored, so a leftover file is the smaller problem.
        }
      }
      throw error
    }
    const experience = toCompanionExperience(trip)
    this.#deps.emit?.(experience)
    this.#log.info(`trip ${trip.id} ${trip.placeName} (${trip.descriptionReason})`)
    return {
      kind: 'trip',
      result: { ok: true, code: 'ok', message: trip.diary, trip },
    }
  }

  #exhausted(message: string): TravelResult {
    const intervalMs = this.#deps.config.travelIntervalSeconds * 1000
    return {
      ok: false,
      code: 'sources-failed',
      message,
      retryAfterMs: Math.max(intervalMs, 5 * 60_000),
    }
  }
}
