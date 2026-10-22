import type { DiaryLanguage, WanderTrip } from './types.js'

export function renderDiarySection(trips: readonly WanderTrip[], language: DiaryLanguage, limit: number): string {
  const shown = trips.slice(0, limit)
  if (shown.length === 0) return ''
  const lines = shown.map((trip) => formatTrip(trip, language))
  if (language === 'en') {
    return [
      '## Travel notes',
      'While the user was away you looked at a public road camera and wrote a diary. Mention one of these naturally, in the first person, the next time you speak. Do not add weather, people, or scene details that the diary does not already contain. One mention is enough.',
      ...lines,
    ].join('\n')
  }
  return [
    '## 旅途记忆',
    '用户离开的时候，你自己去看了公开的路边摄像头，并写下了旅行日记。下次开口时，用第一人称自然地提一句，不要复述整篇，也不要补充日记里没有的天气、行人或画面细节。提过一次就够了。',
    ...lines,
  ].join('\n')
}

function formatTrip(trip: WanderTrip, language: DiaryLanguage): string {
  const where = [trip.placeName, trip.region, trip.country].filter(Boolean).join(' · ')
  const honest = trip.descriptionMode === 'metadata'
    ? (language === 'en'
      ? 'This diary did not look at the picture.'
      : '这篇日记没有看过画面。')
    : (language === 'en'
      ? 'This diary came from a vision description of the snapshot.'
      : '这篇日记来自对快照的视觉描述。')
  return `- ${trip.traveledAt} · ${where}\n  ${trip.diary}\n  ${honest}`
}

export function tripsForPrompt(trips: readonly WanderTrip[], nowMs: number, withinHours: number): WanderTrip[] {
  const horizon = withinHours * 3_600_000
  return trips.filter((trip) => {
    if (trip.mentionedAt) return false
    const at = Date.parse(trip.traveledAt)
    return Number.isFinite(at) && nowMs - at <= horizon && at <= nowMs
  })
}
