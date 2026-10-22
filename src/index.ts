import type { Context } from '@deepseek-ai/cordis'
import { wanderCommand } from './command.js'
import { loadConfig, Config } from './config.js'
import { IdleScheduler, agentKey, isSubagent, type IdleAgent } from './idle.js'
import { MentionTracker, normalizeEventTime } from './mention.js'
import { renderDiarySection, tripsForPrompt } from './prompt.js'
import { recallTool } from './recall.js'
import { TripStore } from './store.js'
import { TravelService } from './travel.js'
import { WANDER_TRIP_EVENT } from './companion.js'
import type { Log } from './types.js'

export const name = 'wander'
export const inject = ['tools', 'systemPrompt', 'timer', 'commands', 'agents']
export { Config }
export { COMPANION_EXPERIENCE_VERSION, WANDER_TRIP_EVENT, toCompanionExperience } from './companion.js'
export type { CompanionExperience, CompanionPlace } from './companion.js'
export type { WanderConfig, WanderTrip, TravelRequest, TravelResult, Place, ExtraPlaceInput } from './types.js'
export { loadConfig } from './config.js'
export { CATALOG } from './catalog.js'

interface HostLogger {
  info(message: string): void
  warn(message: string): void
}

interface HostAgent extends IdleAgent {}

interface Host {
  logger(scope: string): HostLogger
  effect(execute: () => void | (() => void)): () => void
  on(event: string, listener: (...args: any[]) => void): () => void
  emit(event: string, payload?: unknown): void
  timeout(callback: () => void, delayMs: number): () => void
  tools: { register(definition: ReturnType<typeof recallTool>): () => void }
  systemPrompt: {
    section(section: { name: string; order: number; interpolate?: boolean; text: () => string }): () => void
  }
  commands: { register(definition: ReturnType<typeof wanderCommand>): () => void }
  agents: { list(): HostAgent[] }
}

interface SessionEvent {
  type?: string
  time?: number
  data?: { source?: { kind?: string } }
}

interface SessionLike {
  id?: string
  header?: { origin?: string }
}

/**
 * Cordis entry. Idle trips run only after `idleSeconds` without a real user
 * message, then every `travelIntervalSeconds` while the agent stays idle.
 * The diary is not pushed into the session; the next turn reads it from the
 * system prompt and `wander_recall`.
 */
export function apply(ctx: Context, configInput?: unknown): void {
  const config = loadConfig(configInput)
  const host = ctx as unknown as Host
  const logger = host.logger('wander')
  const log: Log = {
    info(message) { logger.info(message) },
    warn(message) { logger.warn(message) },
  }
  host.effect(() => {
    const store = new TripStore(config.dataDir, log)
    const mentions = new MentionTracker()
    const travel = new TravelService({
      config,
      store,
      log,
      emit(experience) {
        host.emit(WANDER_TRIP_EVENT, experience)
      },
    })
    const now = () => new Date()
    const scheduler = new IdleScheduler({
      timeout: (callback, delayMs) => host.timeout(callback, delayMs),
      on: (event, listener) => host.on(event, listener),
      agents: host.agents,
      log,
    }, {
      config,
      now,
      travel: (_agentKey, signal) => travel.travel({ trigger: 'idle', signal }),
      onIdle(agent) {
        const ids = mentions.take(agentKey(agent))
        if (ids.length === 0) return
        store.markMentioned(ids, now().toISOString())
      },
    })
    const stopSession = host.on('session/event', (session: SessionLike, event: SessionEvent) => {
      if (event?.type !== 'user/message' || event.data?.source?.kind !== 'user') return
      if (!session?.id || session.header?.origin === 'subagent') return
      const agent = host.agents.list().find((item) => item.session?.id === session.id)
      if (agent && isSubagent(agent)) return
      mentions.note(session.id, store.unmentioned(), normalizeEventTime(event.time, now().getTime()))
    })
    const forgetAgent = host.on('agent/disposed', (payload: { agent?: IdleAgent }) => {
      const agent = payload?.agent
      if (agent?.session?.id) mentions.forget(agent.session.id)
    })
    const stopTool = host.tools.register(recallTool(store, config, now))
    const stopPrompt = host.systemPrompt.section({
      name: 'wander:diary',
      order: config.promptOrder,
      interpolate: false,
      text: () => renderDiarySection(
        tripsForPrompt(store.unmentioned(), now().getTime(), config.mentionWithinHours),
        config.diaryLanguage,
        config.promptTripCount,
      ),
    })
    const stopCommand = host.commands.register(wanderCommand(travel, config))
    scheduler.start()
    log.info(`wander ready (${config.visionProvider}, ${config.dataDir})`)
    return () => {
      scheduler.stop()
      stopSession()
      forgetAgent()
      stopTool()
      stopPrompt()
      stopCommand()
      store.close()
    }
  })
}
