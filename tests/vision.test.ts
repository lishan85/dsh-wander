import { createServer, type Server } from 'node:http'
import { describe, expect, it } from 'vitest'
import { CATALOG } from '../src/catalog.js'
import { chatCompletionsUrl, describeImage, metadataDescription, parseVisionJson } from '../src/vision.js'
import type { Place } from '../src/types.js'
import { jpeg } from './helpers.js'

const place = CATALOG.find((item) => item.id === 'hanko') as Place
const now = new Date('2026-10-22T05:30:00Z')

describe('description pipeline', () => {
  it('writes an honest metadata diary and does not invent a scene', () => {
    const zh = metadataDescription(place, now, 'zh-CN')
    expect(zh.mode).toBe('metadata')
    expect(zh.mood).toBe('')
    expect(zh.diary).toContain('没有交给视觉模型')
    expect(zh.diary).toContain('上午')
    expect(zh.diary).not.toMatch(/下雨|晴天|下雪|多云|行人|有人在/)
    const en = metadataDescription(place, now, 'en')
    expect(en.diary).toContain('was not sent to a vision model')
    expect(en.diary).toContain('morning')
    expect(en.diary).not.toMatch(/rain|sunny|crowd|someone is/i)
  })

  it('parses fenced and embedded vision JSON', () => {
    expect(parseVisionJson('```json\n{"summary":"calm","diary":"I saw the shore.","mood":"quiet"}\n```')?.diary).toBe('I saw the shore.')
    expect(parseVisionJson('note {"summary":"a","diary":"hello","mood":""} trailing')?.summary).toBe('a')
    expect(parseVisionJson('not json')).toBeUndefined()
  })

  it('appends the chat completions path once', () => {
    expect(chatCompletionsUrl('https://example.com/v1/')).toBe('https://example.com/v1/chat/completions')
    expect(chatCompletionsUrl('https://example.com/v1/chat/completions')).toBe('https://example.com/v1/chat/completions')
  })

  it('does not call the network for metadata, a missing key, or a spent cap', async () => {
    let calls = 0
    const fetchImpl: typeof fetch = async () => {
      calls += 1
      return new Response('no')
    }
    const shared = { place, bytes: jpeg(), mediaType: 'image/jpeg', now, fetchImpl, visionCallsToday: 0, consumeVisionCall: () => true }
    await describeImage({ ...shared, config: config({ visionProvider: 'metadata' }) })
    await describeImage({ ...shared, config: config({ visionProvider: 'openai' }) })
    await describeImage({
      ...shared,
      visionCallsToday: 4,
      config: config({ visionProvider: 'openai', visionBaseUrl: 'https://example.com/v1', visionApiKey: 'sk-test', visionModel: 'demo' }),
    })
    expect(calls).toBe(0)
  })

  it('uses a local vision endpoint and redacts the key when it fails', async () => {
    const key = 'sk-test-secret'
    const server = await listen(async (_req, res) => {
      res.statusCode = 500
      res.end(`bad ${key}`)
    })
    const errors: string[] = []
    let consumed = 0
    try {
      const result = await describeImage({
        config: config({
          visionProvider: 'openai',
          visionBaseUrl: `http://127.0.0.1:${server.port}/v1`,
          visionApiKey: key,
          visionModel: 'demo',
        }),
        place,
        bytes: jpeg(),
        mediaType: 'image/jpeg',
        now,
        visionCallsToday: 0,
        consumeVisionCall: () => {
          consumed += 1
          return true
        },
        onError: (message) => errors.push(message),
      })
      expect(result.reason).toBe('vision-failed')
      expect(result.diary).toContain('没有交给视觉模型')
      expect(consumed).toBe(1)
      expect(errors.join('\n')).not.toContain(key)
      expect(errors.join('\n')).toContain('[redacted]')
    } finally {
      await close(server)
    }
  })

  it('retries once when the endpoint wants max_completion_tokens', async () => {
    let hits = 0
    const server = await listen(async (req, res) => {
      hits += 1
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { max_tokens?: number; max_completion_tokens?: number }
      if (body.max_tokens) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: { message: 'use max_completion_tokens' } }))
        return
      }
      expect(body.max_completion_tokens).toBe(800)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({
        choices: [{ message: { content: '{"summary":"grey sea","diary":"海是灰的。","mood":"quiet"}' } }],
      }))
    })
    try {
      const result = await describeImage({
        config: config({
          visionProvider: 'openai',
          visionBaseUrl: `http://127.0.0.1:${server.port}/v1/chat/completions`,
          visionApiKey: 'sk-local',
          visionModel: 'demo',
        }),
        place,
        bytes: jpeg(),
        mediaType: 'image/jpeg',
        now,
        visionCallsToday: 0,
        consumeVisionCall: () => true,
      })
      expect(hits).toBe(2)
      expect(result.mode).toBe('vision')
      expect(result.diary).toBe('海是灰的。')
      expect(result.mood).toBe('quiet')
    } finally {
      await close(server)
    }
  })
})

function config(extra: Record<string, unknown> = {}) {
  return {
    visionProvider: 'metadata' as const,
    visionBaseUrl: '',
    visionApiKey: '',
    visionModel: '',
    visionTimeoutMs: 5000,
    visionMaxOutputTokens: 800,
    maxVisionCallsPerDay: 4,
    diaryLanguage: 'zh-CN' as const,
    ...extra,
  }
}

function listen(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void): Promise<Server & { port: number }> {
  const server = createServer(handler)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve(Object.assign(server, { port }))
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}
