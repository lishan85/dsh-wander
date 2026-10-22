import { abortError, errorText, isAbort, redact } from './errors.js'
import { timeOfDay, timeOfDayLabel } from './policy.js'
import type { DescriptionMode, DescriptionReason, DiaryLanguage, Place, WanderConfig } from './types.js'

export interface Description {
  mode: DescriptionMode
  reason: DescriptionReason
  summary: string
  diary: string
  mood: string
}

export interface DescribeOptions {
  config: Pick<
    WanderConfig,
    | 'visionProvider'
    | 'visionBaseUrl'
    | 'visionApiKey'
    | 'visionModel'
    | 'visionTimeoutMs'
    | 'visionMaxOutputTokens'
    | 'maxVisionCallsPerDay'
    | 'diaryLanguage'
  >
  place: Place
  bytes: Uint8Array
  mediaType: string
  now: Date
  visionCallsToday: number
  consumeVisionCall: () => boolean
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  /** Receives already-redacted vision failures. */
  onError?: (message: string) => void
}

export function metadataDescription(place: Place, now: Date, language: DiaryLanguage): Description {
  const bucket = timeOfDay(now, place.timezone)
  const when = timeOfDayLabel(bucket, language)
  if (language === 'en') {
    const where = [place.region, place.country].filter(Boolean).join(', ')
    return {
      mode: 'metadata',
      reason: 'metadata',
      summary: `${place.name}, ${where} · ${when} (image not shown to a vision model)`,
      diary: `I stopped by the public camera at ${place.name}${where ? ` in ${where}` : ''}. The picture stayed on this machine and was not sent to a vision model, so I cannot say what the weather is, whether anyone is there, or what the frame shows. Local time of day there is ${when} (${place.timezone}).`,
      mood: '',
    }
  }
  const where = place.region ? `${place.country}的${place.region}` : place.country
  return {
    mode: 'metadata',
    reason: 'metadata',
    summary: `${where} · ${place.name} · ${when}（未看画面）`,
    diary: `刚才我去了${where}，看了「${place.name}」的公开摄像头。画面留在本地，没有交给视觉模型，所以我没法说天气怎么样、有没有人、画面里具体是什么。那里当地这时是${when}（${place.timezone}）。`,
    mood: '',
  }
}

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/chat/completions')) return trimmed
  return `${trimmed}/chat/completions`
}

export async function describeImage(options: DescribeOptions): Promise<Description> {
  const fallback = (reason: DescriptionReason) => ({
    ...metadataDescription(options.place, options.now, options.config.diaryLanguage),
    reason,
  })
  if (options.config.visionProvider !== 'openai') return fallback('metadata')
  if (!options.config.visionApiKey || !options.config.visionBaseUrl || !options.config.visionModel) {
    return fallback('vision-unconfigured')
  }
  if (options.visionCallsToday >= options.config.maxVisionCallsPerDay) return fallback('vision-cap')
  try {
    const text = await complete(options, false)
    const parsed = parseVisionJson(text)
    if (!parsed) return fallback('vision-failed')
    return {
      mode: 'vision',
      reason: 'vision',
      summary: clip(parsed.summary, 280),
      diary: clip(parsed.diary, 1200),
      mood: clip(parsed.mood, 80),
    }
  } catch (error) {
    if (isAbort(error) || options.signal?.aborted) throw abortError()
    const message = redact(errorText(error), options.config.visionApiKey)
    if (message === 'vision-cap') return fallback('vision-cap')
    options.onError?.(message)
    return fallback('vision-failed')
  }
}

async function complete(options: DescribeOptions, useCompletionTokens: boolean): Promise<string> {
  if (!options.consumeVisionCall()) {
    throw new Error('vision-cap')
  }
  const key = options.config.visionApiKey
  const timeout = AbortSignal.timeout(options.config.visionTimeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const body: Record<string, unknown> = {
    model: options.config.visionModel,
    messages: [
      { role: 'system', content: systemPrompt(options.config.diaryLanguage) },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt(options.place, options.config.diaryLanguage) },
          {
            type: 'image_url',
            image_url: { url: `data:${options.mediaType};base64,${Buffer.from(options.bytes).toString('base64')}` },
          },
        ],
      },
    ],
  }
  if (useCompletionTokens) body.max_completion_tokens = options.config.visionMaxOutputTokens
  else body.max_tokens = options.config.visionMaxOutputTokens
  let response: Response
  try {
    response = await fetchImpl(chatCompletionsUrl(options.config.visionBaseUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (isAbort(error)) throw abortError()
    throw new Error(redact(errorText(error), key))
  }
  const raw = await response.text()
  if (!response.ok) {
    if (!useCompletionTokens && response.status === 400 && raw.includes('max_completion_tokens')) {
      return complete(options, true)
    }
    throw new Error(redact(`vision HTTP ${response.status}: ${raw.slice(0, 300)}`, key))
  }
  let payload: unknown
  try {
    payload = JSON.parse(raw) as unknown
  } catch {
    throw new Error('vision response was not JSON')
  }
  return messageText(payload)
}

export function parseVisionJson(text: string): { summary: string; diary: string; mood: string } | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const source = fenced?.[1]?.trim() || sliceObject(text)
  if (!source) return undefined
  let value: unknown
  try {
    value = JSON.parse(source) as unknown
  } catch {
    return undefined
  }
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const diary = typeof record.diary === 'string' ? record.diary.trim() : ''
  if (!diary) return undefined
  const summary = typeof record.summary === 'string' ? record.summary.trim() : diary.slice(0, 120)
  const mood = typeof record.mood === 'string' ? record.mood.trim() : ''
  return { summary, diary, mood }
}

function sliceObject(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return ''
  return text.slice(start, end + 1)
}

function messageText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return ''
  const message = (choices[0] as { message?: { content?: unknown } }).message
  const content = message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => {
    if (typeof part === 'string') return part
    if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
      return (part as { text: string }).text
    }
    return ''
  }).join('')
}

function systemPrompt(language: DiaryLanguage): string {
  const tongue = language === 'en' ? 'English' : '简体中文'
  return [
    `You write a short first-person travel diary in ${tongue} from one public webcam snapshot.`,
    'Reply with JSON only: {"summary":"","diary":"","mood":""}.',
    'Describe only what is visible: weather, time-of-day feeling, whether the road looks busy, and mood.',
    'Do not identify people, read license plates, or invent landmarks that are not visible.',
    'Keep the diary under 120 words.',
  ].join(' ')
}

function userPrompt(place: Place, language: DiaryLanguage): string {
  const where = `${place.name}, ${place.region}, ${place.country}`
  if (language === 'en') {
    return `This public camera is at ${where} (${place.timezone}). Write the diary as if you went there just now.`
  }
  return `这个公开摄像头在${where}（时区 ${place.timezone}）。请用第一人称写你刚刚去看过的日记。`
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}
