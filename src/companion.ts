import type { DescriptionMode, WanderTrip } from './types.js'

export const COMPANION_EXPERIENCE_VERSION = 1

/** Cordis event emitted after a trip is stored. dsh-companion can listen without a hard dependency. */
export const WANDER_TRIP_EVENT = 'wander/trip'

export interface CompanionPlace {
  id: string
  name: string
  region: string
  country: string
  timezone: string
}

export interface CompanionExperience {
  schemaVersion: typeof COMPANION_EXPERIENCE_VERSION
  source: 'dsh-wander'
  kind: 'travel'
  id: string
  at: string
  text: string
  emotionHint: string
  tags: string[]
  place: CompanionPlace
  attribution: string
  license: string
  imageUrl: string
  imagePath: string
  descriptionMode: DescriptionMode
  trip: WanderTrip
}

export function toCompanionExperience(trip: WanderTrip): CompanionExperience {
  return {
    schemaVersion: COMPANION_EXPERIENCE_VERSION,
    source: 'dsh-wander',
    kind: 'travel',
    id: trip.id,
    at: trip.traveledAt,
    text: trip.diary,
    emotionHint: trip.mood,
    tags: ['travel', trip.country, trip.placeId],
    place: {
      id: trip.placeId,
      name: trip.placeName,
      region: trip.region,
      country: trip.country,
      timezone: trip.timezone,
    },
    attribution: trip.attribution,
    license: trip.license,
    imageUrl: trip.imageUrl,
    imagePath: trip.imagePath,
    descriptionMode: trip.descriptionMode,
    trip,
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'wander/trip'(experience: CompanionExperience): void
  }
}
