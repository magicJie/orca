// Where a launched OMP reads its agent dir: an explicit --profile in its command line wins,
// then OMP_PROFILE/PI_PROFILE, then PI_CODING_AGENT_DIR, then <config home>/agent (see
// pi-utils getConfigAgentDirName and cli/profile-bootstrap extractProfileFlags).
import { homedir } from 'node:os'
import { join } from 'node:path'
import { normalizedOmpProfile } from '../../shared/agent-launch/startup/omp-profile'
import { piTitlebarExtensionService } from '../pi/managed-extensions/titlebar-extension-service'

const PROFILE_SCAN_VALUE_FLAGS: Readonly<Record<string, true>> = {
  '-e': true,
  '--alias': true,
  '--approval-mode': true,
  '--config': true,
  '--cwd': true,
  '--extension': true,
  '--goal': true,
  '--max-cost': true,
  '--max-time': true,
  '--mode': true,
  '--model': true,
  '--models': true,
  '--plan': true,
  '--plan-yolo-into': true,
  '--plugin-dir': true,
  '--prewalk-into': true,
  '--prompt-cache-key': true,
  '--provider': true,
  '--provider-session-id': true,
  '--service-tier': true,
  '--session-dir': true,
  '--skills': true,
  '--smol': true,
  '--slow': true,
  '--system-prompt': true,
  '--system-prompt-template': true,
  '--append-system-prompt': true,
  '--thinking': true,
  '--tools': true,
  '--warn-cost': true,
  '--api-key': true,
  '--export': true,
  '--fork': true,
  '--add-dir': true,
  '--hook': true,
  '--trusted-extension': true
}
const PROFILE_SCAN_OPTIONAL_FLAGS: Readonly<Record<string, true>> = {
  '--resume': true,
  '-r': true,
  '--restore': true,
  '--session': true
}
const PROFILE_SCAN_VALUELESS_FLAGS: Readonly<Record<string, true>> = {
  '--help': true,
  '--version': true,
  '--allow-home': true,
  '--continue': true,
  '--from-claude': true,
  '--from-codex': true,
  '--no-session': true,
  '--no-tools': true,
  '--no-lsp': true,
  '--no-pty': true,
  '--hide-thinking': true,
  '--advisor': true,
  '--wait-async': true,
  '--external-thinking': true,
  '--prewalk': true,
  '--no-prewalk': true,
  '--plan-yolo': true,
  '--print': true,
  '--print-thoughts': true,
  '--no-extensions': true,
  '--no-skills': true,
  '--no-rules': true,
  '--no-context-files': true,
  '--no-title': true,
  '--no-ui': true,
  '--auto-approve': true,
  '--yolo': true
}

/** The profile an OMP process will activate from its command line, mirroring
 *  `extractProfileFlags`: --profile/--profile= anywhere before `--` wins (last one stands);
 *  extraction stops at the first non-`-` token, which is the dispatched subcommand. */
function cliProfileArg(argv: readonly string[]): string | undefined {
  let profile: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') {
      break
    }
    if (arg === '--profile' || arg === '--alias') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('-')) {
        continue // OMP errors out; nothing to resolve here
      }
      if (arg === '--profile') {
        profile = value
      }
      index += 1
      continue
    }
    if (arg.startsWith('--profile=')) {
      profile = arg.slice('--profile='.length)
      continue
    }
    if (arg.startsWith('--alias=')) {
      continue
    }
    if (!arg.startsWith('-')) {
      break // first positional is the subcommand; profile flags after it are subcommand args
    }
    if (arg.includes('=')) {
      continue // --flag=value consumes nothing else
    }
    if (PROFILE_SCAN_VALUE_FLAGS[arg]) {
      index += 1 // string flags consume the next token even when flag-looking
      continue
    }
    if (PROFILE_SCAN_VALUELESS_FLAGS[arg]) {
      continue
    }
    if (PROFILE_SCAN_OPTIONAL_FLAGS[arg] || arg.startsWith('--')) {
      const next = argv[index + 1]
      if (next !== undefined && !next.startsWith('-')) {
        index += 1 // optional/unknown flags consume only a value-like token
      }
    }
  }
  return profile
}

function profileAgentDir(profile: string, env: Readonly<Record<string, string>>): string {
  return join(
    (process.platform === 'win32' ? env.USERPROFILE : env.HOME) || homedir(),
    env.PI_CONFIG_DIR || '.omp',
    'profiles',
    profile,
    'agent'
  )
}

/** OMP takes a named profile's folder, under its own home, over PI_CODING_AGENT_DIR. An
 *  explicit --profile in the launch argv beats every environment form. */
export function ompAgentDir(
  env: Readonly<Record<string, string>>,
  launchArgv: readonly string[] = []
): string | undefined {
  const profile = normalizedOmpProfile(
    cliProfileArg(launchArgv) ?? env.OMP_PROFILE ?? env.PI_PROFILE
  )
  return profile ? profileAgentDir(profile, env) : env.PI_CODING_AGENT_DIR
}

/** Writes Orca's managed extensions where the launched OMP will read them; unmanaged
 *  accounts fall back to OMP's default agent dir under its config home. */
export function installOmpManagedExtensions(
  env: Readonly<Record<string, string>>,
  launchArgv: readonly string[] = []
): void {
  const agentDir =
    ompAgentDir(env, launchArgv) ??
    join(
      (process.platform === 'win32' ? env.USERPROFILE : env.HOME) || homedir(),
      env.PI_CONFIG_DIR || '.omp',
      'agent'
    )
  piTitlebarExtensionService.installManagedExtensions(agentDir, 'omp')
}
