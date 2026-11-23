import { expect, it, vi } from 'vitest'
import { piTitlebarExtensionService } from '../pi/managed-extensions/titlebar-extension-service'
import { resolveAcpLaunchCommand } from '../acp/launch/acp-launch-command'
import { acpLaunchSpecFor } from '../acp/launch/acp-launch-registry'
import { installOmpManagedExtensions } from './omp-agent-dir'

function spyInstall(): { calls: string[]; restore: () => void } {
  const calls: string[] = []
  const install = vi
    .spyOn(piTitlebarExtensionService, 'installManagedExtensions')
    .mockImplementation((dir: string) => {
      calls.push(dir)
      return { sourceAgentDir: dir }
    })
  return { calls, restore: () => install.mockRestore() }
}

function installedAgentDirs(
  env: Readonly<Record<string, string>>,
  launchArgv: readonly string[] = []
): string[] {
  const { calls, restore } = spyInstall()
  try {
    installOmpManagedExtensions(env, launchArgv)
  } finally {
    restore()
  }
  return calls
}

it('installs into a named profile agent dir over PI_CODING_AGENT_DIR', () => {
  expect(
    installedAgentDirs({
      HOME: '/home/u',
      OMP_PROFILE: 'work',
      PI_CODING_AGENT_DIR: '/isolated/omp'
    })
  ).toEqual(['/home/u/.omp/profiles/work/agent'])
})

it('honors PI_CODING_AGENT_DIR without a profile, falling back to OMP config home', () => {
  expect(installedAgentDirs({ HOME: '/home/u', PI_CODING_AGENT_DIR: '/isolated/omp' })).toEqual([
    '/isolated/omp'
  ])
  expect(installedAgentDirs({ HOME: '/home/u' })).toEqual(['/home/u/.omp/agent'])
})

it('lets a command-line --profile beat OMP_PROFILE (REVIEW2 counterexample)', () => {
  expect(
    installedAgentDirs(
      { HOME: '/home/u', OMP_PROFILE: 'from-env', PI_CODING_AGENT_DIR: '/isolated/omp' },
      ['--profile', 'from-cli']
    )
  ).toEqual(['/home/u/.omp/profiles/from-cli/agent'])
  expect(
    installedAgentDirs({ HOME: '/home/u', OMP_PROFILE: 'from-env' }, ['--profile=from-cli'])
  ).toEqual(['/home/u/.omp/profiles/from-cli/agent'])
})

it('skips global flag values before a profile flag, stopping at a subcommand', () => {
  // --model's value is not a profile; extraction must not mistake `gpt` for a subcommand.
  expect(
    installedAgentDirs({ HOME: '/home/u' }, ['--model', 'gpt-4.1', '--profile', 'work'])
  ).toEqual(['/home/u/.omp/profiles/work/agent'])
  // After the acp subcommand, --profile belongs to that subcommand, not the global bootstrap.
  expect(installedAgentDirs({ HOME: '/home/u' }, ['acp', '--profile', 'later'])).toEqual([
    '/home/u/.omp/agent'
  ])
  expect(
    installedAgentDirs({ HOME: '/home/u' }, ['--profile', 'work', '--', '--profile', 'x'])
  ).toEqual(['/home/u/.omp/profiles/work/agent'])
})

it('consumes the -e extension flag value before profile extraction (REVIEW3)', () => {
  // `-e file.js` is a valued global flag: the script path is not a positional subcommand,
  // so `--profile work` still counts and `acp` never appears in this scan.
  expect(
    installedAgentDirs({ HOME: '/home/u' }, ['-e', 'file.js', '--profile', 'work', 'acp'])
  ).toEqual(['/home/u/.omp/profiles/work/agent'])
  expect(installedAgentDirs({ HOME: '/home/u' }, ['-e', 'acp'])).toEqual(['/home/u/.omp/agent'])
})

it('resolves the CLI profile through the real ACP launch command path', () => {
  const { calls, restore } = spyInstall()
  try {
    resolveAcpLaunchCommand(
      acpLaunchSpecFor('omp')!,
      { HOME: '/home/u', OMP_PROFILE: 'from-env' },
      {
        commandSettings: { agentCmdOverrides: { omp: `${process.execPath} --profile from-cli` } },
        resolveCommand: () => '/installed/omp',
        dataDirectory: null
      }
    )
  } finally {
    restore()
  }
  expect(calls).toEqual(['/home/u/.omp/profiles/from-cli/agent'])
})
