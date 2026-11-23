import { afterEach, expect, it } from 'vitest'
import { OMP_ACP_DIALECT } from '../acp-dialects/omp-dialect'
import { AcpTimelineTranslator } from './acp-timeline-translator'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  closeTestJournalHostDatabase,
  createTrackedJournalOpener,
  type TestJournalOptions
} from '../../native-chat/agent-session-journal/store-lifecycle/journal-host-database-test-support'
import { createDeferredStructuredAgentSessionEventSink } from '../../native-chat/agent-session-wire/journal-ingress/structured-agent-session-event-sink'
import { testEventSinkLogging } from '../../native-chat/agent-session-wire/host/testing/structured-agent-session-logger.test-fixture'
import { createProviderTimelineAssembler } from '../../native-chat/agent-session-timeline/provider-timeline-assembler'
import { providerTimelineSink } from '../../native-chat/agent-session-timeline/provider-timeline-plan'
import { readTestJournalItems } from '../../native-chat/agent-session-journal/journal-observation.test-support'
import { selectStructuredAgentSettledTurns } from '../../../shared/agent-session/view/structured-agent-session-turn-timing'

const journals = createTrackedJournalOpener()
const cleanups: (() => void)[] = []
const roots: string[] = []

afterEach(async () => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  await journals.closeAll()
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function openProviderTimelineRig() {
  const root = await mkdtemp(join(tmpdir(), 'orca-omp-generation-'))
  roots.push(root)
  const options: TestJournalOptions = {
    identity: {
      sessionId: 'omp-session',
      workspaceId: 'workspace-1',
      hostId: 'local',
      agent: 'omp',
      providerHandle: { transport: 'acp', agent: 'omp', nativeId: 'omp-session' }
    },
    stateDirectory: root,
    now: () => 1_000
  }
  let journal = await journals.open(options)
  const deferred = createDeferredStructuredAgentSessionEventSink(testEventSinkLogging())
  deferred.bind({ journal, fence: 1, publish: () => {} })
  const sink = providerTimelineSink(deferred.sink)
  if (!sink) {
    throw new Error('Expected provider timeline sink')
  }
  const assembler = createProviderTimelineAssembler({
    sink,
    sessionId: options.identity.sessionId,
    agent: 'omp',
    generation: 'gen-1',
    namespace: 'omp-session'
  })
  cleanups.push(() => {
    assembler.dispose()
    deferred.close()
  })
  const rows = async () => {
    assembler.flush()
    expect(await deferred.drained()).toEqual({ ok: true })
    return readTestJournalItems(journal)
  }
  return {
    assembler,
    rows,
    reopenJournal: async () => {
      await rows()
      deferred.close()
      await journal.close()
      await closeTestJournalHostDatabase(root)
      journal = await journals.open(options)
      return journal
    }
  }
}

it('retains provider-token throughput across settlement and reload without counting tool time', async () => {
  const rig = await openProviderTimelineRig()
  const translator = new AcpTimelineTranslator({
    sessionId: 'omp-session',
    dialect: OMP_ACP_DIALECT
  })
  const first = translator.openPrompt('first', 1_000)
  first.events.forEach((event) => rig.assembler.apply(event))
  translator
    .notification('_orca/omp/generation', { outputTokens: 42, durationMs: 500 }, 2_000)
    .forEach((event) => rig.assembler.apply(event))
  translator
    .notification('_orca/omp/generation', { outputTokens: 84, durationMs: 2_000 }, 30_000)
    .forEach((event) => rig.assembler.apply(event))
  translator
    .promptResult('first', { stopReason: 'end_turn' }, 31_000)
    .forEach((event) => rig.assembler.apply(event))
  const before = selectStructuredAgentSettledTurns(await rig.rows())
  expect([...before.values()][0]?.tokensPerSecond).toBe(42)

  const reopened = await rig.reopenJournal()
  const restored = selectStructuredAgentSettledTurns(await readTestJournalItems(reopened))
  expect([...restored.values()][0]?.tokensPerSecond).toBe(42)
})

it('leaves an unmeasured response unavailable rather than timing replayed text', async () => {
  const rig = await openProviderTimelineRig()
  const translator = new AcpTimelineTranslator({
    sessionId: 'omp-session',
    dialect: OMP_ACP_DIALECT
  })
  translator.beginLoad()
  expect(
    translator.notification('_orca/omp/generation', { outputTokens: 84, durationMs: 2_000 }, 20_000)
  ).toEqual([])
  translator.finishLoad()
  translator.openPrompt('unknown', 21_000).events.forEach((event) => rig.assembler.apply(event))
  translator
    .notification('_orca/omp/generation', { outputTokens: 84, durationMs: 0 }, 22_000)
    .forEach((event) => rig.assembler.apply(event))
  translator
    .promptResult('unknown', { stopReason: 'end_turn' }, 23_000)
    .forEach((event) => rig.assembler.apply(event))
  const settled = selectStructuredAgentSettledTurns(await rig.rows())
  expect([...settled.values()][0]?.tokensPerSecond).toBeUndefined()
})
