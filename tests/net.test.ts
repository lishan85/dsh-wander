import { describe, expect, it } from 'vitest'
import { checkPublicUrl, fetchSnapshot, HostLimiter, isPrivateAddress, sniffImage } from '../src/net.js'
import { imageResponse, jpeg, ManualClock, publicResolve } from './helpers.js'

const allowed = ['weathercam.digitraffic.fi']

describe('snapshot fetching', () => {
  it('rejects insecure, local, and private targets before any request', async () => {
    expect(checkPublicUrl('http://weathercam.digitraffic.fi/a.jpg').ok).toBe(false)
    expect(checkPublicUrl('https://user:pass@weathercam.digitraffic.fi/a.jpg').ok).toBe(false)
    expect(checkPublicUrl('https://localhost/a.jpg').ok).toBe(false)
    expect(checkPublicUrl('https://camera.local/a.jpg').ok).toBe(false)
    expect(checkPublicUrl('https://127.0.0.1/a.jpg').ok).toBe(false)
    expect(checkPublicUrl('https://10.1.1.1/a.jpg').ok).toBe(false)
    expect(checkPublicUrl('https://192.168.0.8/a.jpg').ok).toBe(false)
    expect(checkPublicUrl('https://169.254.1.1/a.jpg').ok).toBe(false)
    expect(checkPublicUrl('https://100.64.0.1/a.jpg').ok).toBe(false)
    expect(isPrivateAddress('::1')).toBe(true)
    expect(isPrivateAddress('1.1.1.1')).toBe(false)
    let called = false
    const result = await fetchSnapshot({
      url: 'https://127.0.0.1/a.jpg',
      allowedHosts: [],
      timeoutMs: 1000,
      retries: 0,
      maxBytes: 1000,
      minHostIntervalMs: 0,
      limiter: new HostLimiter(new ManualClock()),
      fetchImpl: async () => {
        called = true
        return imageResponse(jpeg())
      },
    })
    expect(result.ok).toBe(false)
    expect(called).toBe(false)
  })

  it('rejects a public name that resolves to a private address', async () => {
    const result = await fetchSnapshot({
      url: 'https://weathercam.digitraffic.fi/a.jpg',
      allowedHosts: allowed,
      timeoutMs: 1000,
      retries: 0,
      maxBytes: 1000,
      minHostIntervalMs: 0,
      limiter: new HostLimiter(new ManualClock()),
      resolve: async () => ['10.0.0.8'],
      fetchImpl: async () => imageResponse(jpeg()),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('blocked')
  })

  it('rejects HTML, tiny bodies, and oversized bodies', async () => {
    const html = await fetchSnapshot(options(async () => new Response('<html><body>nope</body></html>')))
    expect(html.ok).toBe(false)
    if (!html.ok) expect(html.code).toBe('invalid-image')
    const tiny = await fetchSnapshot(options(async () => imageResponse(jpeg(20))))
    expect(tiny.ok).toBe(false)
    const huge = await fetchSnapshot({
      ...options(async () => imageResponse(jpeg(400))),
      maxBytes: 300,
    })
    expect(huge.ok).toBe(false)
    if (!huge.ok) expect(huge.code).toBe('too-large')
  })

  it('retries a 500 and does not retry a 404', async () => {
    let attempts = 0
    const recovered = await fetchSnapshot(options(async () => {
      attempts += 1
      if (attempts === 1) return new Response('no', { status: 500 })
      return imageResponse(jpeg(), 200, { etag: '"v1"' })
    }))
    expect(recovered.ok).toBe(true)
    expect(attempts).toBe(2)
    let missing = 0
    const gone = await fetchSnapshot({
      ...options(async () => {
        missing += 1
        return new Response('missing', { status: 404 })
      }),
      retries: 2,
    })
    expect(gone.ok).toBe(false)
    expect(missing).toBe(1)
  })

  it('does not follow a redirect off the camera host', async () => {
    const result = await fetchSnapshot(options(async (input) => {
      const url = String(input)
      if (url.includes('weathercam.digitraffic.fi')) {
        return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/secret.jpg' } })
      }
      return imageResponse(jpeg())
    }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('blocked')
  })

  it('waits for the per-host interval', async () => {
    const clock = new ManualClock()
    const limiter = new HostLimiter(clock)
    const bytes = jpeg()
    const fetchImpl: typeof fetch = async () => imageResponse(bytes)
    const shared = { ...options(fetchImpl), limiter, clock, minHostIntervalMs: 1500 }
    const first = await fetchSnapshot(shared)
    const second = await fetchSnapshot(shared)
    expect(first.ok && second.ok).toBe(true)
    expect(clock.waits).toEqual([1500])
  })

  it('recognizes JPEG magic bytes', () => {
    expect(sniffImage(jpeg())?.mediaType).toBe('image/jpeg')
  })
})

function options(fetchImpl: typeof fetch) {
  return {
    url: 'https://weathercam.digitraffic.fi/C0150701.jpg',
    allowedHosts: allowed,
    timeoutMs: 1000,
    retries: 1,
    maxBytes: 8000,
    minHostIntervalMs: 0,
    limiter: new HostLimiter(new ManualClock()),
    resolve: publicResolve,
    fetchImpl,
    clock: new ManualClock(),
  }
}
