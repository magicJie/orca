import { expect, it, vi } from 'vitest'
import { createAcpStructuredLaunchResolver } from '../../runtime/agent-session/launch/structured-agent-launch-composition.test-support'
import { agentSessionRecordFixture } from '../../native-chat/testing/agent-session-record-test-fixture'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host/execution-host'
import { piTitlebarExtensionService } from '../../pi/managed-extensions/titlebar-extension-service'
import { acpLaunchSpecFor } from './acp-launch-registry'

it.each([false, true])(
  'installs OMP managed extensions without a launch flag (saved conversation: %s)',
  async (saved) => {
    const install = vi
      .spyOn(piTitlebarExtensionService, 'installManagedExtensions')
      .mockImplementation(() => ({ sourceAgentDir: '/isolated/omp' }))
    const handle = { transport: 'acp', agent: 'omp', nativeId: 'saved-omp' }
    const record = agentSessionRecordFixture({
      sessionId: 'omp-chat',
      provider: 'omp',
      accountHome: { variable: 'PI_CODING_AGENT_DIR', path: '/isolated/omp' },
      options: { model: 'custom/gpt-4.1' },
      providerHandleChain: saved
        ? [
            {
              linkId: 'saved',
              handle,
              origin: 'adopted',
              mintedAtFence: 1,
              observedAt: 1
            }
          ]
        : []
    })
    try {
      const resolved = await createAcpStructuredLaunchResolver(acpLaunchSpecFor('omp')!, {
        store: { getRecord: () => record, pinLaunchDirectory: async () => record },
        resolveCommand: () => '/installed/omp',
        resolveEnvironment: async () => ({ PATH: '/usr/bin' }),
        prepareVisuals: async () => null,
        probeVersion: async () => ({ version: '18.19.0' }),
        savedSession: { hasProviderTurn: async () => true }
      })({
        identity: {
          sessionId: 'omp-chat',
          workspaceId: 'workspace-1',
          hostId: LOCAL_EXECUTION_HOST_ID,
          agent: 'omp',
          providerHandle: saved ? handle : null
        }
      })
      expect(install).toHaveBeenCalledWith('/isolated/omp', 'omp')
      expect(resolved.args).toEqual(['acp', ...(saved ? [] : ['--model', 'custom/gpt-4.1'])])
      expect(resolved.resume?.sessionId).toBe(saved ? 'saved-omp' : undefined)
    } finally {
      install.mockRestore()
    }
  }
)
