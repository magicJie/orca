import type { AgentSessionProviderContextBoundary } from '../conversation-context/agent-session-provider-context'
import type { AgentSessionForkedFromMark } from '../conversation-naming/agent-session-fork-name'
import type {
  AgentJournalBoundedPayload,
  AgentJournalThreadGoalState,
  AgentJournalTurnLifecycle
} from './agent-session-journal-types'

export type AgentJournalStatusItemFields = {
  kind: 'status'
  /** Optional display hints; unknown values retain the ordinary text fallback. */
  presentation?: string
  contextClear?: AgentSessionProviderContextBoundary
  tone?: string
  /** Legacy carrier for clients predating turn items; read through readAgentJournalTurn. */
  turnLifecycle?: AgentJournalTurnLifecycle
  /** Older clients render text; newer clients expose this bounded frame. */
  providerFrame?: {
    provider: string
    kind: string
    payload: AgentJournalBoundedPayload
  }
  threadGoal?: AgentJournalThreadGoalState
  /** Open cause vocabulary, read through readAgentSessionOrcaStop. */
  orcaStop?: { cause: string }
  /** On the derived "Forked from" row: the chat this one was forked from. */
  forkedFrom?: AgentSessionForkedFromMark
}
