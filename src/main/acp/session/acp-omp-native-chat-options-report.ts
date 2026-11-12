// OMP extension reports carry native chat options; a ready session republishes them immediately.

import type { OmpNativeChatOptions } from '../../omp/omp-native-chat-options'
import * as childState from './children/acp-structured-child'
import type { AcpStructuredOptions } from '../options/acp-structured-options'
import { reportAcpSessionOptions } from '../options/acp-live-options'
import type { AcpStructuredSessionAdapterDeps } from './acp-structured-session-adapter-deps'

export function adoptOmpNativeChatOptionsReport(
  report: OmpNativeChatOptions,
  options: AcpStructuredOptions,
  session: childState.AcpStructuredChild | null,
  onEvent: AcpStructuredSessionAdapterDeps['onEvent']
): void {
  options.adoptServiceTiers(report)
  if (childState.isAcpReadySession(session) && !session.ended) {
    reportAcpSessionOptions(onEvent, session)
  }
}
