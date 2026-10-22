import { homedir } from 'node:os'
import path from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { CATALOG } from './catalog.js'
import { WanderError, errorText } from './errors.js'
import { assertTimezone, parseClock } from './policy.js'
import type { ExtraPlaceInput, WanderConfig } from './types.js'

const PLACE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/

const extraPlaceSchema = Schema.object({
  id: Schema.string().pattern(PLACE_ID).required(),
  name: Schema.string().required(),
  region: Schema.string().default(''),
  country: Schema.string().required(),
  timezone: Schema.string().required(),
  latitude: Schema.number().min(-90).max(90).required(),
  longitude: Schema.number().min(-180).max(180).required(),
  snapshotUrl: Schema.string().required(),
  pageUrl: Schema.string().required(),
  attribution: Schema.string().required(),
  license: Schema.string().required(),
  tosUrl: Schema.string().required(),
})

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('Turn idle travel and the manual command on or off.'),
  dataDir: Schema.string().default('').description('Trip database directory. Empty uses DSH_HOME/wander.'),
  idleSeconds: Schema.natural().min(1).default(1200).description('How long the user must be idle before the first trip.'),
  travelIntervalSeconds: Schema.natural().min(60).default(10800).description('Minimum gap between idle trips.'),
  dailyCap: Schema.natural().default(4).description('Maximum stored trips per local day. 0 disables trips unless /wander force.'),
  quietHoursStart: Schema.string().default('23:00').description('Local quiet-hours start (HH:MM). Equal to the end disables quiet hours.'),
  quietHoursEnd: Schema.string().default('07:00').description('Local quiet-hours end (HH:MM).'),
  timezone: Schema.string().default('').description('IANA timezone for caps and quiet hours. Empty uses the host zone.'),
  mentionWithinHours: Schema.natural().min(1).default(36).description('How long an unmentioned diary stays in the prompt.'),
  promptTripCount: Schema.natural().min(1).max(10).default(3).description('How many unmentioned diaries to include in the prompt.'),
  promptOrder: Schema.number().default(80).description('System prompt section order.'),
  saveImages: Schema.boolean().default(true).description('Keep the snapshot under dataDir/images.'),
  maxImageBytes: Schema.natural().min(1024).default(8_000_000),
  fetchTimeoutMs: Schema.natural().min(1000).default(20_000),
  fetchRetries: Schema.natural().max(5).default(2).description('Extra attempts after the first fetch.'),
  maxPlaceAttempts: Schema.natural().min(1).max(8).default(3),
  minHostIntervalMs: Schema.natural().default(1500).description('Minimum gap between requests to the same host.'),
  sourceCooldownSeconds: Schema.natural().default(21600).description('Avoid a camera that was fetched this recently.'),
  repeatPlaceHours: Schema.natural().default(18),
  avoidRecentPlaces: Schema.natural().max(50).default(5),
  startupGraceSeconds: Schema.natural().default(15).description('Minimum wait after startup for sessions that are already idle.'),
  visionProvider: Schema.union([Schema.const('metadata'), Schema.const('openai')]).default('metadata'),
  visionBaseUrl: Schema.string().default('').description('OpenAI-compatible base URL. /chat/completions is appended when missing.'),
  visionApiKey: Schema.string().default(''),
  visionModel: Schema.string().default(''),
  visionTimeoutMs: Schema.natural().min(1000).default(60_000),
  visionMaxOutputTokens: Schema.natural().min(1).default(800),
  maxVisionCallsPerDay: Schema.natural().default(4).description('Vision HTTP calls per local day. 0 always uses the metadata diary.'),
  diaryLanguage: Schema.union([Schema.const('zh-CN'), Schema.const('en')]).default('zh-CN'),
  windyApiKey: Schema.string().default(''),
  windyEnabled: Schema.boolean().default(false),
  windyWeight: Schema.number().min(0).max(1).default(0.35).description('Chance to ask Windy before the curated list, when a key is set.'),
  enabledPlaceIds: Schema.array(Schema.string()).default([]).description('If non-empty, only these places are used and Windy is not mixed in.'),
  disabledPlaceIds: Schema.array(Schema.string()).default([]),
  extraPlaces: Schema.array(extraPlaceSchema).default([]),
})

export function defaultDataDir(): string {
  const home = process.env.DSH_HOME || path.join(homedir(), '.dsh')
  return path.join(home, 'wander')
}

export function loadConfig(input: unknown): WanderConfig {
  let parsed: WanderConfig
  try {
    parsed = Config(asRecord(input)) as WanderConfig
  } catch (error) {
    throw new WanderError('config', errorText(error))
  }
  return finalize(parsed)
}

function finalize(config: WanderConfig): WanderConfig {
  parseClock(config.quietHoursStart)
  parseClock(config.quietHoursEnd)
  assertTimezone(config.timezone)
  for (const place of config.extraPlaces) {
    assertTimezone(place.timezone)
    assertHttps(place.snapshotUrl, `${place.id} snapshotUrl`)
    assertHttps(place.pageUrl, `${place.id} pageUrl`)
    assertHttps(place.tosUrl, `${place.id} tosUrl`)
    requireText(place.attribution, `${place.id} attribution`)
    requireText(place.license, `${place.id} license`)
    requireText(place.name, `${place.id} name`)
    requireText(place.country, `${place.id} country`)
  }
  const extraIds = config.extraPlaces.map((place) => place.id)
  const duplicates = extraIds.filter((id, index) => extraIds.indexOf(id) !== index)
  if (duplicates.length > 0) {
    throw new WanderError('config', `duplicate extra place id ${duplicates[0]}`)
  }
  const catalogIds = new Set(CATALOG.map((place) => place.id))
  for (const id of extraIds) {
    if (catalogIds.has(id)) throw new WanderError('config', `extra place id ${id} collides with a built-in place`)
  }
  const known = new Set<string>([...catalogIds, ...extraIds])
  for (const id of config.enabledPlaceIds) assertKnownPlace(id, known, 'enabledPlaceIds')
  for (const id of config.disabledPlaceIds) assertKnownPlace(id, known, 'disabledPlaceIds')
  const denied = new Set(config.disabledPlaceIds)
  for (const id of config.enabledPlaceIds) {
    if (denied.has(id)) throw new WanderError('config', `${id} is both enabled and disabled`)
  }
  if (config.visionProvider === 'openai' && config.visionBaseUrl) {
    assertHttps(config.visionBaseUrl, 'visionBaseUrl')
  }
  return {
    ...config,
    dataDir: config.dataDir.trim() || defaultDataDir(),
    enabledPlaceIds: [...config.enabledPlaceIds],
    disabledPlaceIds: [...config.disabledPlaceIds],
    extraPlaces: config.extraPlaces.map(copyExtra),
  }
}

function copyExtra(place: ExtraPlaceInput): ExtraPlaceInput {
  return { ...place }
}

function assertKnownPlace(id: string, known: ReadonlySet<string>, field: string): void {
  if (!known.has(id)) throw new WanderError('config', `${field} contains unknown place id ${id}`)
}

function requireText(value: string, label: string): void {
  if (!value.trim()) throw new WanderError('config', `${label} is required`)
}

export function assertHttps(value: string, label: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new WanderError('config', `${label} is not a valid URL`)
  }
  if (url.protocol !== 'https:') throw new WanderError('config', `${label} must use https`)
  if (url.username || url.password) throw new WanderError('config', `${label} must not contain credentials`)
  if (!url.hostname) throw new WanderError('config', `${label} is missing a host`)
  return url
}

function asRecord(input: unknown): Record<string, unknown> {
  if (input === undefined || input === null) return {}
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new WanderError('config', 'config must be an object')
  }
  return input as Record<string, unknown>
}
