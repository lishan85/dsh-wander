import { dayKey, isQuiet, resolveTimezone } from './policy.js'
import type { TripStore } from './store.js'
import type { WanderConfig, WanderTrip } from './types.js'

const tripSchema = {
  type: 'object',
  additionalProperties: false,
  description: 'One stored trip.',
  properties: {
    id: { type: 'string' },
    traveledAt: { type: 'string' },
    placeId: { type: 'string' },
    placeName: { type: 'string' },
    country: { type: 'string' },
    region: { type: 'string' },
    diary: { type: 'string' },
    summary: { type: 'string' },
    descriptionMode: { type: 'string', enum: ['vision', 'metadata'] },
    mentioned: { type: 'boolean' },
    attribution: { type: 'string' },
    imagePath: { type: 'string' },
    imageUrl: { type: 'string' },
  },
  required: [
    'id',
    'traveledAt',
    'placeId',
    'placeName',
    'country',
    'region',
    'diary',
    'summary',
    'descriptionMode',
    'mentioned',
    'attribution',
    'imagePath',
    'imageUrl',
  ],
} as const

export const recallParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', description: 'How many recent trips to return, from 1 to 20. Default 5.' },
    query: { type: 'string', description: 'Optional case-insensitive text to match against the diary and place.' },
  },
  required: [] as string[],
} as const

export const recallOutputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    trips: { type: 'array', items: tripSchema },
    todayCount: { type: 'integer' },
    dailyCap: { type: 'integer' },
    visionCallsToday: { type: 'integer' },
    maxVisionCallsPerDay: { type: 'integer' },
    quiet: { type: 'boolean' },
    note: { type: 'string' },
  },
  required: ['trips', 'todayCount', 'dailyCap', 'visionCallsToday', 'maxVisionCallsPerDay', 'quiet', 'note'],
} as const

export interface RecallArgs {
  limit?: number
  query?: string
}

export interface RecallTrip {
  id: string
  traveledAt: string
  placeId: string
  placeName: string
  country: string
  region: string
  diary: string
  summary: string
  descriptionMode: 'vision' | 'metadata'
  mentioned: boolean
  attribution: string
  imagePath: string
  imageUrl: string
}

export interface RecallResult {
  trips: RecallTrip[]
  todayCount: number
  dailyCap: number
  visionCallsToday: number
  maxVisionCallsPerDay: number
  quiet: boolean
  note: string
}

export function recallTool(store: TripStore, config: WanderConfig, now: () => Date = () => new Date()) {
  return {
    name: 'wander_recall',
    description: 'Read recent local travel diaries written while the user was idle. Metadata diaries did not look at the picture, so do not invent weather or people for those.',
    parameters: recallParameters,
    output: {
      schema: recallOutputSchema,
      render(_args: unknown, value: unknown) {
        const result = value as RecallResult
        const lines = result.trips.map((trip) => `${trip.traveledAt} ${trip.placeName}: ${trip.diary}`)
        const body = lines.length > 0 ? lines.join('\n') : 'No trips yet.'
        return [{ type: 'text' as const, text: `${body}\n${result.note}` }]
      },
    },
    async execute(args: unknown): Promise<RecallResult> {
      const parsed = parseArgs(args)
      const moment = now()
      const zone = resolveTimezone(config.timezone)
      const today = dayKey(moment, zone)
      const trips = (parsed.query ? store.search(parsed.query, parsed.limit) : store.listRecent(parsed.limit)).map(toRecall)
      const quiet = isQuiet(moment, config.quietHoursStart, config.quietHoursEnd, zone)
      const note = config.diaryLanguage === 'en'
        ? `Today ${store.countOnDay(today)}/${config.dailyCap} trips, vision calls ${store.visionCallsOnDay(today)}/${config.maxVisionCallsPerDay}. Quiet hours ${quiet ? 'are' : 'are not'} active. Metadata entries did not see the image.`
        : `今天 ${store.countOnDay(today)}/${config.dailyCap} 次旅行，视觉调用 ${store.visionCallsOnDay(today)}/${config.maxVisionCallsPerDay}。安静时段${quiet ? '进行中' : '未生效'}。标成 metadata 的日记没有看过画面。`
      return {
        trips,
        todayCount: store.countOnDay(today),
        dailyCap: config.dailyCap,
        visionCallsToday: store.visionCallsOnDay(today),
        maxVisionCallsPerDay: config.maxVisionCallsPerDay,
        quiet,
        note,
      }
    },
  }
}

function parseArgs(args: unknown): { limit: number; query: string } {
  const record = args && typeof args === 'object' ? args as RecallArgs : {}
  const limit = typeof record.limit === 'number' && Number.isInteger(record.limit)
    ? Math.min(20, Math.max(1, record.limit))
    : 5
  const query = typeof record.query === 'string' ? record.query : ''
  return { limit, query }
}

function toRecall(trip: WanderTrip): RecallTrip {
  return {
    id: trip.id,
    traveledAt: trip.traveledAt,
    placeId: trip.placeId,
    placeName: trip.placeName,
    country: trip.country,
    region: trip.region,
    diary: trip.diary,
    summary: trip.summary,
    descriptionMode: trip.descriptionMode,
    mentioned: trip.mentionedAt !== '',
    attribution: trip.attribution,
    imagePath: trip.imagePath,
    imageUrl: trip.imageUrl,
  }
}
