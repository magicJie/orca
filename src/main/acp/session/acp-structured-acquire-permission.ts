// Permission request routing for acquireAcpStructuredSession.

import {
  RequestPermissionResponseSchema,
  type PermissionOption
} from '../generated/acp-protocol.generated'
import { acpAnswersRequests } from '../launch/acp-launch-permission-modes'
import type { AcpPermissionHandler } from '../protocol/acp-permission-requests'
import * as childState from './children/acp-structured-child'
import type { AcpStructuredPrompts } from '../requests/acp-structured-prompts'
import type { AcpLaunchSpec } from '../launch/acp-launch-contract'

type AcpAcquirePermissionSpec = Pick<AcpLaunchSpec, 'dialect' | 'permissionModeConfig'>

export function acpAcquirePermissionHandler(
  spec: AcpAcquirePermissionSpec,
  session: () => childState.AcpStructuredChild | null,
  prompts: AcpStructuredPrompts
): AcpPermissionHandler {
  return (request, context) => {
    const current = session()
    if (!childState.isAcpReadySession(current) || !current.turns?.acceptsRequests) {
      // Nobody can answer during Stop, a steer or teardown.
      return { outcome: { outcome: 'cancelled' } }
    }
    // Do not auto-approve questions or permissions enforced by the agent's own mode.
    const claimed = spec.dialect.request?.('session/request_permission', request)
    if (current.permission === 'full-access' && acpAnswersRequests(spec) && !claimed) {
      const allow = (request.options as PermissionOption[]).find(
        (option) => option.kind === 'allow_once'
      )
      if (allow) {
        return { outcome: { outcome: 'selected', optionId: allow.optionId } }
      }
    }
    return prompts
      .handle('session/request_permission', request, context)
      .then((reply) => RequestPermissionResponseSchema.parse(reply))
  }
}
