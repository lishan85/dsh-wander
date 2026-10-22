import { findPlace, resolvePlaces } from './catalog.js'
import type { TravelService } from './travel.js'
import type { DiaryLanguage, TravelResult, WanderConfig, WanderTrip } from './types.js'

export interface ParsedWanderInput {
  force: boolean
  placeId?: string
  error?: string
}

export function parseWanderInput(raw: string): ParsedWanderInput {
  const tokens = raw.trim().split(/\s+/).filter(Boolean)
  let force = false
  const places: string[] = []
  for (const token of tokens) {
    if (token.toLowerCase() === 'force') force = true
    else places.push(token)
  }
  if (places.length > 1) {
    return { force, error: 'only one place id is allowed' }
  }
  const placeId = places[0]
  return placeId ? { force, placeId } : { force }
}

export function wanderCommand(travel: TravelService, config: WanderConfig) {
  const language = config.diaryLanguage
  return {
    name: 'wander',
    description: language === 'en'
      ? 'Look at a public webcam now and write a travel diary. Usage: /wander [place-id] [force]'
      : '现在去看一个公开摄像头，并写一篇旅行日记。用法：/wander [地点 id] [force]',
    input: { hint: '[place-id] [force]' },
    async handler(invocation: { rawInput?: string; signal?: AbortSignal }) {
      const parsed = parseWanderInput(invocation.rawInput ?? '')
      if (parsed.error) return { kind: 'error' as const, text: text(language, '只能指定一个地点 id。', parsed.error) }
      if (parsed.placeId && !findPlace(resolvePlaces(config), parsed.placeId)) {
        return {
          kind: 'error' as const,
          text: text(language, `没有这个地点，或它被配置关掉了：${parsed.placeId}`, `unknown or disabled place: ${parsed.placeId}`),
        }
      }
      const result = await travel.travel({
        trigger: 'manual',
        force: parsed.force,
        placeId: parsed.placeId,
        signal: invocation.signal,
      })
      if (!result.ok) return { kind: 'error' as const, text: failureText(language, result) }
      return { kind: 'success' as const, text: successText(language, result.trip) }
    },
  }
}

function successText(language: DiaryLanguage, trip: WanderTrip | undefined): string {
  if (!trip) return text(language, '旅行结束了，但没有留下日记。', 'The trip finished without a diary.')
  const where = [trip.placeName, trip.region, trip.country].filter(Boolean).join(' · ')
  if (language === 'en') {
    return `${trip.diary}\n\n— ${where}\n${trip.attribution}\n${trip.pageUrl}`
  }
  return `${trip.diary}\n\n—— ${where}\n${trip.attribution}\n${trip.pageUrl}`
}

function failureText(language: DiaryLanguage, result: TravelResult): string {
  switch (result.code) {
    case 'disabled':
      return text(language, 'dsh-wander 当前是关闭的。', 'dsh-wander is disabled.')
    case 'busy':
      return text(language, '正在看另一处风景，请稍后再试。', 'Another trip is already in progress.')
    case 'daily-cap':
      return text(language, '今天的旅行次数已经用完。可以加 force 再去一次。', 'The daily trip cap is reached. Add force to go anyway.')
    case 'unknown-place':
      return text(language, result.message, result.message)
    case 'aborted':
      return text(language, '这次旅行被取消了。', 'The trip was cancelled.')
    case 'sources-failed':
      return text(language, `没有拿到可用的画面：${result.message}`, `No usable snapshot: ${result.message}`)
    default:
      return text(language, `这次没去成：${result.message}`, `The trip did not happen: ${result.message}`)
  }
}

function text(language: DiaryLanguage, zh: string, en: string): string {
  return language === 'en' ? en : zh
}
