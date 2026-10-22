export type VisionProvider = 'metadata' | 'openai'

export type DiaryLanguage = 'zh-CN' | 'en'

export type PlaceSource = 'catalog' | 'extra' | 'windy'

export type DescriptionMode = 'vision' | 'metadata'

export type DescriptionReason =
  | 'metadata'
  | 'vision'
  | 'vision-unconfigured'
  | 'vision-cap'
  | 'vision-failed'

export interface Place {
  id: string
  name: string
  region: string
  country: string
  timezone: string
  latitude: number
  longitude: number
  snapshotUrl: string
  pageUrl: string
  attribution: string
  license: string
  tosUrl: string
  allowedHosts: readonly string[]
  source: PlaceSource
  headers?: Readonly<Record<string, string>>
}

export interface ExtraPlaceInput {
  id: string
  name: string
  region: string
  country: string
  timezone: string
  latitude: number
  longitude: number
  snapshotUrl: string
  pageUrl: string
  attribution: string
  license: string
  tosUrl: string
}

export interface WanderConfig {
  enabled: boolean
  dataDir: string
  idleSeconds: number
  travelIntervalSeconds: number
  dailyCap: number
  quietHoursStart: string
  quietHoursEnd: string
  timezone: string
  mentionWithinHours: number
  promptTripCount: number
  promptOrder: number
  saveImages: boolean
  maxImageBytes: number
  fetchTimeoutMs: number
  fetchRetries: number
  maxPlaceAttempts: number
  minHostIntervalMs: number
  sourceCooldownSeconds: number
  repeatPlaceHours: number
  avoidRecentPlaces: number
  startupGraceSeconds: number
  visionProvider: VisionProvider
  visionBaseUrl: string
  visionApiKey: string
  visionModel: string
  visionTimeoutMs: number
  visionMaxOutputTokens: number
  maxVisionCallsPerDay: number
  diaryLanguage: DiaryLanguage
  windyApiKey: string
  windyEnabled: boolean
  windyWeight: number
  enabledPlaceIds: string[]
  disabledPlaceIds: string[]
  extraPlaces: ExtraPlaceInput[]
}

export interface WanderTrip {
  id: string
  traveledAt: string
  dayKey: string
  placeId: string
  placeName: string
  region: string
  country: string
  timezone: string
  latitude: number
  longitude: number
  source: PlaceSource
  snapshotUrl: string
  pageUrl: string
  attribution: string
  license: string
  tosUrl: string
  imagePath: string
  imageUrl: string
  descriptionMode: DescriptionMode
  descriptionReason: DescriptionReason
  summary: string
  diary: string
  mood: string
  mentionedAt: string
}

export interface TravelRequest {
  trigger: 'idle' | 'manual'
  placeId?: string
  force?: boolean
  signal?: AbortSignal
}

export interface TravelResult {
  ok: boolean
  code: string
  message: string
  retryAfterMs?: number
  trip?: WanderTrip
}

export interface Log {
  info(message: string): void
  warn(message: string): void
}

export interface Clock {
  now(): number
  wait(ms: number, signal?: AbortSignal): Promise<void>
}

export const noopLog: Log = {
  info() {},
  warn() {},
}
