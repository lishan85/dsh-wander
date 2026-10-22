import { errorText } from './errors.js'
import { capDelay, firstIdleDelayMs } from './policy.js'
import type { Log, TravelResult, WanderConfig } from './types.js'

export interface IdleSessionEvent {
  type: string
  time?: number
  data?: { source?: { kind?: string } }
}

export interface IdleAgent {
  status?: string
  session: {
    id: string
    header?: { origin?: string }
    snapshotEvents?: (from?: number, toExclusive?: number) => IdleSessionEvent[]
  }
}

export interface IdleHost {
  timeout(callback: () => void, delayMs: number): () => void
  on(event: string, listener: (payload: any) => void): () => void
  agents: { list(): IdleAgent[] }
  log: Log
}

export function agentKey(agent: IdleAgent): string {
  return agent.session.id
}

export function isSubagent(agent: IdleAgent): boolean {
  return agent.session.header?.origin === 'subagent'
}

export function lastUserActivityMs(agent: IdleAgent): number | undefined {
  let events: IdleSessionEvent[] = []
  try {
    events = agent.session.snapshotEvents?.() ?? []
  } catch {
    return undefined
  }
  let last: number | undefined
  for (const event of events) {
    if (event.type !== 'user/message') continue
    if (event.data?.source?.kind !== 'user') continue
    if (typeof event.time !== 'number' || !Number.isFinite(event.time)) continue
    last = event.time > 0 && event.time < 1e12 ? event.time * 1000 : event.time
  }
  return last
}

/** Delay until the next idle attempt. `undefined` means do not re-arm. */
export function nextIdleDelay(result: TravelResult, travelIntervalSeconds: number): number | undefined {
  if (result.code === 'aborted' || result.code === 'disabled') return undefined
  if (result.ok) return capDelay(travelIntervalSeconds * 1000)
  if (result.code === 'sources-failed') {
    return capDelay(Math.max(travelIntervalSeconds * 1000, 5 * 60_000))
  }
  if (result.code === 'busy' || result.code === 'error') return 60_000
  if (result.retryAfterMs && result.retryAfterMs > 0) return capDelay(result.retryAfterMs)
  return undefined
}

export class IdleScheduler {
  readonly #timers = new Map<string, () => void>()
  readonly #inflight = new Map<string, AbortController>()
  readonly #tokens = new Map<string, number>()
  readonly #stops: Array<() => void> = []
  #started = false

  constructor(
    private readonly host: IdleHost,
    private readonly deps: {
      config: WanderConfig
      now: () => Date
      travel: (agentKey: string, signal: AbortSignal) => Promise<TravelResult>
      onIdle: (agent: IdleAgent) => void
    },
  ) {}

  start(): void {
    if (this.#started || !this.deps.config.enabled) return
    this.#started = true
    this.#stops.push(this.host.on('agent/status', (payload) => {
      const agent = agentFrom(payload)
      if (!agent) return
      if (payload?.status === 'idle') {
        try {
          this.deps.onIdle(agent)
        } catch (error) {
          this.host.log.warn(`wander mention update failed: ${errorText(error)}`)
        }
        this.arm(agent, 'user-idle')
      } else {
        this.disarm(agent)
      }
    }))
    this.#stops.push(this.host.on('agent/created', (payload) => {
      const agent = agentFrom(payload)
      if (!agent) return
      this.arm(agent, 'created')
    }))
    this.#stops.push(this.host.on('agent/disposed', (payload) => {
      const agent = agentFrom(payload)
      if (!agent) return
      this.disarm(agent)
    }))
    for (const agent of this.host.agents.list()) {
      if (!agent?.session || isSubagent(agent)) continue
      if (agent.status && agent.status !== 'idle') continue
      this.arm(agent, 'startup')
    }
  }

  stop(): void {
    this.#started = false
    for (const stop of this.#stops.splice(0)) stop()
    for (const key of [...this.#tokens.keys()]) {
      this.#invalidate(key)
    }
  }

  arm(agent: IdleAgent, reason: 'startup' | 'created' | 'user-idle'): void {
    if (!agent.session || isSubagent(agent)) return
    const key = agentKey(agent)
    const token = this.#invalidate(key)
    const delay = firstIdleDelayMs({
      reason,
      nowMs: this.deps.now().getTime(),
      lastUserMs: lastUserActivityMs(agent),
      idleSeconds: this.deps.config.idleSeconds,
      startupGraceSeconds: this.deps.config.startupGraceSeconds,
    })
    this.#schedule(agent, delay, token)
  }

  disarm(agent: IdleAgent): void {
    if (!agent.session) return
    this.#invalidate(agentKey(agent))
  }

  #schedule(agent: IdleAgent, delayMs: number, token: number): void {
    const key = agentKey(agent)
    const dispose = this.host.timeout(() => {
      void this.#fire(agent, token)
    }, delayMs)
    this.#timers.set(key, dispose)
  }

  async #fire(agent: IdleAgent, token: number): Promise<void> {
    const key = agentKey(agent)
    this.#timers.delete(key)
    if (this.#tokens.get(key) !== token) return
    const controller = new AbortController()
    this.#inflight.set(key, controller)
    let result: TravelResult
    try {
      result = await this.deps.travel(key, controller.signal)
    } catch (error) {
      this.host.log.warn(`wander idle trip failed: ${errorText(error)}`)
      result = { ok: false, code: 'error', message: errorText(error), retryAfterMs: 60_000 }
    } finally {
      this.#inflight.delete(key)
    }
    if (this.#tokens.get(key) !== token || result.code === 'aborted') return
    const delay = nextIdleDelay(result, this.deps.config.travelIntervalSeconds)
    if (delay === undefined) return
    this.#schedule(agent, delay, token)
  }

  #invalidate(key: string): number {
    const token = (this.#tokens.get(key) ?? 0) + 1
    this.#tokens.set(key, token)
    const timer = this.#timers.get(key)
    if (timer) {
      this.#timers.delete(key)
      timer()
    }
    const inflight = this.#inflight.get(key)
    if (inflight) {
      this.#inflight.delete(key)
      inflight.abort()
    }
    return token
  }
}

function agentFrom(payload: any): IdleAgent | undefined {
  const agent = payload?.agent ?? payload
  if (!agent || typeof agent !== 'object' || !agent.session?.id) return undefined
  return agent as IdleAgent
}
