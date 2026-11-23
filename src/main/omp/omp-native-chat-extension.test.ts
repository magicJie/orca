import { transformSync } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { getOmpNativeChatExtensionSource } from '../pi/managed-extensions/omp-native-chat-extension-source'
import { getOmpNativeChatNotifySource } from '../pi/managed-extensions/omp-native-chat-notify-source'

function runSource(source: string, context: Record<string, unknown>) {
  const module: { exports: { default?: (api: unknown) => void } } = { exports: {} }
  const code = transformSync(source, { format: 'cjs', platform: 'node', loader: 'ts' }).code
  runInNewContext(code, { module, exports: module.exports, ...context })
  if (typeof module.exports.default !== 'function') {
    throw new Error('Managed extension did not export its entry point')
  }
  return module.exports.default
}

function extensions(argv: string[] = ['omp', 'acp']) {
  const frames: { method: string; params: unknown }[] = []
  const hooks = new Map<string, (event: unknown, context: unknown) => void>()
  const commands: Record<string, { handler: (value: string, ctx: unknown) => void }> = {}
  const busHandlers = new Map<string, Set<(data: unknown) => void>>()
  const tiers: Record<string, string | undefined> = {}
  const pi = {
    on: (name: string, hook: (event: unknown, context: unknown) => void) => hooks.set(name, hook),
    registerCommand: (
      name: string,
      options: { handler: (value: string, ctx: unknown) => void }
    ) => {
      commands[name] = options
    },
    getServiceTiers: () => ({ ...tiers }),
    setServiceTier: (family: string, tier: string | undefined) => {
      tiers[family] = tier
    },
    events: {
      emit: (channel: string, data: unknown) => {
        busHandlers.get(channel)?.forEach((handler) => handler(data))
      },
      on: (channel: string, handler: (data: unknown) => void) => {
        if (!busHandlers.has(channel)) {
          busHandlers.set(channel, new Set())
        }
        busHandlers.get(channel)!.add(handler)
      }
    }
  }
  runSource(getOmpNativeChatExtensionSource('omp'), { performance, process: { argv } })(pi)
  runSource(getOmpNativeChatNotifySource('omp'), {
    process: { argv },
    require: (name: string) => {
      if (name === 'node:fs') {
        return { writeSync: (_fd: number, frame: string) => frames.push(JSON.parse(frame)) }
      }
      throw new Error(`Unexpected module ${name}`)
    }
  })(pi)
  return {
    frames,
    tiers,
    commands,
    hooks,
    emit: (name: string, event = {}, ctx: unknown = { agent: { kind: 'main' } }) =>
      hooks.get(name)?.(event, ctx)
  }
}

const mainCtx = { agent: { kind: 'main' } }
const openAiModel = {
  provider: 'openai',
  id: 'gpt-4.1',
  api: 'openai-responses',
  identity: { class: 'openai' }
}

describe('managed OMP native chat extensions', () => {
  it('publishes cumulative native counters before agent_end despite synthetic zero-token notices', () => {
    const native = extensions()
    native.emit('agent_start')
    native.emit('message_end', { message: { role: 'assistant', usage: { output: 0 } } })
    native.emit('message_end', {
      message: { role: 'assistant', usage: { output: 84 }, duration: 2_000 }
    })
    expect(native.frames).toMatchObject([
      { method: '_orca/omp/generation', params: { outputTokens: 84, durationMs: 2_000 } }
    ])
    native.emit(
      'message_end',
      { message: { role: 'assistant', usage: { output: 999 }, duration: 1 } },
      { agent: { kind: 'sub' } }
    )
    native.emit('message_end', {
      message: { role: 'assistant', usage: { output: 42 }, duration: 1_000 }
    })
    expect(native.frames.at(-1)).toMatchObject({
      method: '_orca/omp/generation',
      params: { outputTokens: 126, durationMs: 3_000 }
    })
  })

  it('leaves missing counters or request timing unmeasured', () => {
    const native = extensions()
    native.emit('agent_start')
    native.emit('message_end', { message: { role: 'assistant', usage: { output: 84 } } })
    expect(native.frames).toEqual([])
    native.emit('agent_start')
    native.emit('before_provider_request')
    native.emit('message_end', { message: { role: 'assistant' } })
    expect(native.frames).toEqual([])
  })

  it.each([
    ['no mode subcommand', ['omp']],
    // A plain RPC session whose session dir is literally `acp` must not emit ACP frames.
    ['acp as a flag value', ['omp', '--session-dir', 'acp']],
    ['acp after another subcommand', ['omp', 'chat', 'acp']],
    // REVIEW2 §②: terminal auth turns a real acp dispatch into the interactive TUI.
    ['terminal auth TUI', ['omp', 'acp', '--acp-terminal-auth']],
    ['rpc launch with acp session dir', ['omp', 'launch', '--mode', 'rpc', '--session-dir', 'acp']],
    ['end of options before acp', ['omp', '--', 'acp']],
    // OMP treats an unknown long flag's value-like successor as that flag's value.
    ['unknown flag swallows acp', ['omp', '--some-extension-flag', 'acp']],
    // REVIEW3: `-e file.js` consumes its value; the file is not the subcommand.
    ['extension flag consumes acp', ['omp', '-e', 'acp']]
  ])('stays silent outside ACP mode (%s)', (_label, argv) => {
    const native = extensions(argv)
    expect([...native.hooks.keys()]).toEqual([])
    expect(Object.keys(native.commands)).toEqual([])
    native.emit(
      'session_start',
      {},
      {
        agent: { kind: 'main' },
        modelRegistry: { getAvailable: () => [openAiModel] }
      }
    )
    expect(native.frames).toEqual([])
  })

  it.each([
    ['script path before acp (node/bun invocation)', ['node', '/tmp/omp-cli.js', 'acp']],
    // REVIEW2 §②: a global profile flag ahead of acp still dispatches ACP.
    ['global profile prefix', ['omp', '--profile', 'work', 'acp']],
    ['global profile prefix with =', ['omp', '--profile=work', 'acp']],
    // Value-less launch flags do not consume a following positional (OMP flagConsumesValue).
    ['value-less flag before acp', ['omp', '--print', 'acp']]
  ])('activates ACP mode (%s)', (_label, argv) => {
    const native = extensions(argv)
    native.emit(
      'session_start',
      {},
      {
        agent: { kind: 'main' },
        modelRegistry: { getAvailable: () => [openAiModel] }
      }
    )
    expect(native.frames).toMatchObject([{ method: '_orca/omp/options' }])
  })

  it('reports per-model tiers and applies the command through the public API', () => {
    const native = extensions()
    const ctx = {
      ...mainCtx,
      modelRegistry: { getAvailable: () => [openAiModel] },
      model: openAiModel
    }
    native.emit('session_start', {}, ctx)
    expect(native.frames[0]).toMatchObject({
      method: '_orca/omp/options',
      params: {
        models: [
          {
            id: 'openai/gpt-4.1',
            serviceTier: 'none',
            serviceTiers: [
              { value: 'none' },
              { value: 'auto' },
              { value: 'default' },
              { value: 'flex' },
              { value: 'scale' },
              { value: 'priority' },
              { value: 'ultrafast' }
            ]
          }
        ]
      }
    })

    native.commands['orca-service-tier'].handler('priority', ctx)
    expect(native.tiers.openai).toBe('priority')
    expect(native.frames.at(-1)).toMatchObject({
      method: '_orca/omp/options',
      params: { models: [{ id: 'openai/gpt-4.1', serviceTier: 'priority' }] }
    })
    native.commands['orca-service-tier'].handler('none', ctx)
    expect(native.tiers.openai).toBeUndefined()
    expect(() => native.commands['orca-service-tier'].handler('bogus', ctx)).toThrow(
      'This model has no matching native service tier'
    )
  })
})
