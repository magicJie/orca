// Turn mapping and extension-event assembly for AcpTimelineTranslator.notification().

import type {
  ProviderTimelineEvent,
  ProviderTimelineJoin
} from '../../native-chat/agent-session-timeline/provider-timeline-event'
import type { AcpDialectNotification } from '../acp-dialects/acp-dialect'
import type { SessionUpdate } from '../generated/acp-protocol.generated'
import { ACP_SUBSTANTIVE_UPDATES } from './acp-session-update'
import type { AcpContextTimeline } from './acp-context-usage'
import type { AcpBackgroundTaskTimeline } from './acp-background-task-timeline'
import type { AcpPromptTurns } from './acp-prompt-turns'
import type { AcpSubagents } from './acp-subagents'
import type { AcpAgentTurns } from './acp-agent-turns'
import type { AcpTimelineOwnership } from './acp-timeline-ownership'

export function acpTimelineTurnResolution(
  extension: Extract<AcpDialectNotification, { disposition: 'map' }> | undefined,
  update: SessionUpdate | undefined,
  open: string | undefined,
  ownership: AcpTimelineOwnership,
  prompts: AcpPromptTurns,
  agentTurns: AcpAgentTurns,
  at: number
) {
  const opens =
    (update !== undefined && ACP_SUBSTANTIVE_UPDATES.includes(update.sessionUpdate)) ||
    (extension?.disposition === 'map' &&
      (extension.end !== undefined || extension.started === true))
  // Provider and session turns win; a substantive frame with neither mints its own
  // (reactive agents answer background work on a fresh turn).
  // Host command IDs cannot join provider-keyed turns, even when their late frames outlive `last`.
  const offeredTurn = extension?.turn ?? open ?? agentTurns.mint(opens, at, update)
  const operation = ownership.operation()
  const owner = update
    ? ownership.messages.owner(offeredTurn, update, operation.settled)
    : { turn: offeredTurn }
  // Host command IDs cannot join provider-keyed turns, even when their late frames outlive `last`.
  const settledCommand =
    owner.turn?.startsWith('compact:') === true && prompts.current?.turn !== owner.turn
  const turn = prompts.compacting(owner.turn) || settledCommand ? undefined : owner.turn
  return { opens, operation, owner, settledCommand, turn }
}

export function acpTimelineExtensionEvents(
  extension: AcpDialectNotification | undefined,
  turn: string | undefined,
  join: ProviderTimelineJoin,
  at: number,
  context: AcpContextTimeline,
  backgroundTasks: AcpBackgroundTaskTimeline,
  subagents: AcpSubagents
): ProviderTimelineEvent[] {
  const events: ProviderTimelineEvent[] = []
  if (extension?.disposition !== 'map') {
    return events
  }
  if (extension.backgroundTasks) {
    const tasks = extension.backgroundTasks.filter((task) => !subagents.has(task.taskId))
    events.push(...backgroundTasks.translate(tasks, join))
  }
  if (extension.subagents) {
    events.push(...subagents.translate(extension.subagents, join, at))
  }
  if (extension.usage) {
    events.push(...context.update(extension.usage, join))
  }
  if (extension.generationUsage && turn) {
    events.push({ type: 'generation.usage', usage: extension.generationUsage, join })
  }
  return events
}
