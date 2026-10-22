import type { Place } from './types.js'

export interface SelectInput {
  places: readonly Place[]
  preferredId?: string
  lastPlaceId?: string
  lastCountry?: string
  recentPlaceIds: readonly string[]
  cooledIds: ReadonlySet<string>
  limit: number
  rng: () => number
}

export function selectPlaces(input: SelectInput): Place[] {
  if (input.preferredId) {
    const preferred = input.places.find((place) => place.id === input.preferredId)
      ?? input.places.find((place) => place.id === input.preferredId?.toLowerCase())
    return preferred ? [preferred] : []
  }
  if (input.places.length === 0 || input.limit <= 0) return []
  const cooled = input.places.filter((place) => input.cooledIds.has(place.id))
  const fresh = input.places.filter((place) => !input.cooledIds.has(place.id))
  const pool = fresh.length > 0 ? fresh : cooled
  const recent = new Set(input.recentPlaceIds)
  const ranked = pool.map((place) => ({
    place,
    score: scorePlace(place, input, recent),
  }))
  ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    return left.place.id < right.place.id ? -1 : left.place.id > right.place.id ? 1 : 0
  })
  return ranked.slice(0, input.limit).map((item) => item.place)
}

function scorePlace(place: Place, input: SelectInput, recent: ReadonlySet<string>): number {
  let score = 1 + input.rng() * 0.3
  if (place.id === input.lastPlaceId) score -= 0.9
  else if (place.country === input.lastCountry) score -= 0.35
  if (recent.has(place.id)) score -= 0.5
  return score
}
