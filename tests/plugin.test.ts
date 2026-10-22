import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { TimerService } from '@deepseek-ai/cordis-plugin-timer'
import * as wander from '../src/index.js'
import { recallOutputSchema, recallParameters } from '../src/recall.js'
import { removeDir, tempDir } from './helpers.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) removeDir(dir)
})

describe('plugin API', () => {
  it('loads inside cordis and registers recall, the diary section, and /wander', async () => {
    const dir = tempDir()
    dirs.push(dir)
    const root = new Context()
    const tools = new ToolService(root)
    const prompts = new PromptService(root)
    const commands = new CommandService(root)
    const agents = new AgentService(root)
    // Constructing a Service outside plugin() registers it on the root fiber.
    void tools
    void prompts
    void commands
    void agents
    await root.plugin(TimerService)
    const fiber = root.plugin(wander, {
      dataDir: dir,
      idleSeconds: 86_400,
      startupGraceSeconds: 86_400,
      travelIntervalSeconds: 86_400,
      dailyCap: 0,
    })
    await fiber
    expect(tools.tools.map((tool) => tool.name)).toEqual(['wander_recall'])
    expect(prompts.sections[0]?.name).toBe('wander:diary')
    expect(prompts.sections[0]?.interpolate).toBe(false)
    expect(prompts.sections[0]?.text()).toBe('')
    expect(commands.commands.map((command) => command.name)).toEqual(['wander'])
    const recall = await tools.tools[0]?.execute({})
    expect(recall.trips).toEqual([])
    expect(recall.dailyCap).toBe(0)
    expect(typeof recall.note).toBe('string')
    const command = commands.commands[0]
    expect(command).toBeDefined()
    const unknown = await command?.handler({ rawInput: 'not-a-place', signal: new AbortController().signal })
    expect(unknown?.kind).toBe('error')
    const bus = root as unknown as { emit: (name: string, ...args: unknown[]) => void }
    bus.emit('session/event', { id: 's1', header: {} }, {
      type: 'user/message',
      time: Date.now(),
      data: { source: { kind: 'user' } },
    })
    bus.emit('agent/status', { agent: { session: { id: 's1', header: {} }, status: 'idle' }, status: 'running' })
    bus.emit('agent/created', { agent: { session: { id: 's2', header: { origin: 'subagent' } } }, source: 'startup' })
    bus.emit('agent/disposed', { agent: { session: { id: 's1', header: {} } } })
    await (fiber as { dispose(): Promise<void> | void }).dispose()
  })

  it('rejects an invalid config before the plugin applies', async () => {
    const root = new Context()
    new ToolService(root)
    new PromptService(root)
    new CommandService(root)
    new AgentService(root)
    await root.plugin(TimerService)
    await expect(root.plugin(wander, { idleSeconds: 0 })).rejects.toThrow()
  })
})

describe('recall schema', () => {
  it('matches the dsh JSON Schema subset when that checker is installed', async () => {
    const schemaPath = '/tmp/dsh-runtime/node_modules/@deepseek-ai/dsh-tools/lib/types/json-schema.js'
    if (!existsSync(schemaPath)) return
    const checker = await import(schemaPath) as { assertSupportedJsonSchema(schema: unknown): void }
    expect(() => checker.assertSupportedJsonSchema(recallParameters)).not.toThrow()
    expect(() => checker.assertSupportedJsonSchema(recallOutputSchema)).not.toThrow()
  })
})

class ToolService extends Service {
  tools: Array<{ name: string; execute: (args: unknown) => Promise<any> }> = []

  constructor(ctx: Context) {
    super(ctx, 'tools')
  }

  register(definition: { name: string; execute: (args: unknown) => Promise<any> }) {
    this.tools.push(definition)
    return () => {
      this.tools = this.tools.filter((tool) => tool !== definition)
    }
  }
}

class PromptService extends Service {
  sections: Array<{ name: string; interpolate?: boolean; text: () => string }> = []

  constructor(ctx: Context) {
    super(ctx, 'systemPrompt')
  }

  section(definition: { name: string; interpolate?: boolean; text: () => string }) {
    this.sections.push(definition)
    return () => {
      this.sections = this.sections.filter((section) => section !== definition)
    }
  }
}

class CommandService extends Service {
  commands: Array<{ name: string; handler: (invocation: { rawInput?: string; signal?: AbortSignal }) => Promise<{ kind: string }> }> = []

  constructor(ctx: Context) {
    super(ctx, 'commands')
  }

  register(definition: { name: string; handler: (invocation: { rawInput?: string; signal?: AbortSignal }) => Promise<{ kind: string }> }) {
    this.commands.push(definition)
    return () => {
      this.commands = this.commands.filter((command) => command !== definition)
    }
  }
}

class AgentService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'agents')
  }

  list() {
    return []
  }
}
