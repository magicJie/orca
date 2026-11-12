// Disposable-session model listing for the ACP catalog probe.
// The probe starts a chat to read models it does not list through its CLI.

import { join } from 'node:path'
import type { AgentSessionModelOption } from '../../../shared/agent-session/options/model-catalog/agent-session-model-option'
import {
  agentSessionAccountHomePath,
  type AgentSessionAccountHome
} from '../../../shared/agent-session/lifecycle/accounts/agent-session-account-home'
import {
  assertStructuredAgentResolutionCurrent,
  type StructuredAgentResolutionOperation
} from '../../native-chat/agent-launch/structured-agent-command-resolution'
import type { AgentModelCatalogProgress } from '../../native-chat/agent-model-catalog/agent-model-catalog-discovery'
import { runAgentModelCatalogSession } from '../../native-chat/agent-model-catalog/agent-model-catalog-probe-runner'
import { createAcpAgentConnection } from '../process/acp-agent-connection'
import { acpRunFolder } from '../launch/acp-private-temp'
import type { AcpLaunchSpec } from '../launch/acp-launch-contract'
import type { ProviderProcessLaunch } from '../../provider-process/provider-process-launch'
import {
  readOmpNativeChatOptions,
  withOmpServiceTiers,
  type OmpNativeChatOptions
} from '../../omp/omp-native-chat-options'
import {
  readSessionModels,
  type AcpModelCatalogSessionConnection
} from './acp-listing-session-models'
import type { AcpSessionModelDiscovery } from './acp-model-discovery-policy'
import type { AcpModelCatalogProbeDeps } from './acp-model-catalog-probe'
import type { AgentCliVersionReader } from '../../agent-launch/preflight/agent-cli-version-probe'

import type { AcpAgentConnectionOptions } from '../process/acp-agent-connection'

type SessionListingDeps = Pick<AcpModelCatalogProbeDeps, 'dataDirectory' | 'connectSession'> & {
  probeVersion?: AgentCliVersionReader
}

export type AcpSessionListingResult = {
  models: AgentSessionModelOption[]
  attemptedModels: string[]
}

/** Read a model listing through one disposable chat session; folder cleanup is on the caller's finally path. */
export function acpSessionModelListing(input: {
  spec: AcpLaunchSpec
  listing: AcpSessionModelDiscovery
  deps: SessionListingDeps
  launch: ProviderProcessLaunch
  prefixArgs: string[]
  workspace: string | undefined
  accountHome: AgentSessionAccountHome | undefined
  pluginDirs: readonly string[]
  extensionPath: string | undefined
  connectionOptions: AcpAgentConnectionOptions
  operation: StructuredAgentResolutionOperation | undefined
  selectedModels?: readonly string[]
  publish?: AgentModelCatalogProgress
  run: { label: string; signal?: AbortSignal; timeoutMs: number | null }
}): (model: string | undefined) => Promise<AcpSessionListingResult> {
  const { spec, listing, deps, launch, prefixArgs, workspace, accountHome } = input
  const { pluginDirs, extensionPath, connectionOptions, operation, publish, run } = input
  const folderArgs = listing.sessionFolderArgs
  return async (model: string | undefined) => {
    const folder =
      folderArgs || listing.inPrivateFolder
        ? await acpRunFolder(join(deps.dataDirectory, 'acp-listing-sessions', spec.agent))
        : null
    const sessionCwd = listing.inPrivateFolder && folder ? folder.path : workspace
    const started: string[] = []
    let tierReport: OmpNativeChatOptions | undefined
    try {
      assertStructuredAgentResolutionCurrent(operation)
      const args = [
        ...prefixArgs,
        ...spec.args({ fullAccess: false, pluginDirs, extensionPath, model }),
        ...(folderArgs && folder ? folderArgs(folder.path) : [])
      ]
      const result = await runAgentModelCatalogSession<
        AcpModelCatalogSessionConnection,
        Awaited<ReturnType<typeof readSessionModels>>
      >(
        () =>
          (deps.connectSession ?? createAcpAgentConnection)(
            { ...launch, args },
            {
              ...connectionOptions,
              onExtensionNotification: (method, params) => {
                tierReport = readOmpNativeChatOptions(method, params) ?? tierReport
              }
            }
          ),
        (connection, ready) =>
          readSessionModels(
            spec,
            listing,
            connection,
            sessionCwd!,
            operation,
            input.selectedModels,
            model,
            spec.dialect.effortChangesModel ? ready : undefined,
            (result) =>
              publish?.(
                {
                  ...result,
                  models: [...result.models],
                  attemptedModels: [...result.attemptedModels],
                  origin: 'probe',
                  complete: false
                },
                true
              ),
            publish?.defer && publish.demanded
              ? {
                  defer: (read, known) =>
                    publish.defer?.(() => ({ ...read(), origin: 'probe', complete: false }), known),
                  demanded: publish.demanded
                }
              : undefined,
            (sessionId) => started.push(sessionId)
          ),
        run
      )
      return { ...result, models: withOmpServiceTiers(result.models, tierReport) }
    } finally {
      // The session's process has exited, so its files are no longer written.
      const accountHomePath = agentSessionAccountHomePath(accountHome ?? null)
      if (accountHomePath) {
        for (const sessionId of started) {
          await listing
            .discardSession?.({ sessionId, cwd: sessionCwd!, accountHomePath })
            .catch((error: unknown) => {
              console.warn(`[acp-model-catalog] ${spec.agent} kept a listing session:`, error)
            })
        }
      }
      await folder?.remove()
    }
  }
}
