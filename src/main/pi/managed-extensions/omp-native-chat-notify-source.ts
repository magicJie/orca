import {
  ORCA_OMP_GENERATION_EVENT,
  ORCA_OMP_OPTIONS_EVENT
} from './omp-native-chat-extension-source'
import { getOmpAcpModeSourceLines } from './omp-acp-mode-source'
import type { PiAgentKind } from '../../../shared/agent-launch/catalog/pi-agent-kind'

export const ORCA_OMP_NATIVE_CHAT_NOTIFY_FILE = 'orca-omp-native-chat-notify.ts'

/**
 * DELETE with the second upstreaming cut: OMP's public extension API exposes no
 * channel that emits custom ACP session/update notifications, so tier and
 * generation reports still ride the private raw-stdout JSON-RPC bridge the
 * bundled `omp-native-chat.mjs` used. Once OMP broadcasts service tiers through
 * ACP configOptions (fork fastConfigId path), this file and its consumers in
 * `src/main/omp/omp-native-chat-options.ts` go away.
 */
export function getOmpNativeChatNotifySource(kind: PiAgentKind): string {
  if (kind !== 'omp') {
    throw new Error(`orca native chat notify only supports OMP sessions, not ${kind}`)
  }
  return [
    'export default function (pi): void {',
    ...getOmpAcpModeSourceLines(),
    '  if (!isAcp || !pi.events) return',
    '  // OMP redirects process.stdout.write to stderr in ACP; protocol frames use the actual stdout fd.',
    "  const writeSync = require('node:fs').writeSync",
    '  const notify = (method, params) =>',
    "    writeSync(1, `${JSON.stringify({ jsonrpc: '2.0', method, params })}\\n`)",
    `  pi.events.on('${ORCA_OMP_OPTIONS_EVENT}', (params) => notify('_orca/omp/options', params))`,
    `  pi.events.on('${ORCA_OMP_GENERATION_EVENT}', (params) => notify('_orca/omp/generation', params))`,
    '}'
  ].join('\n')
}
