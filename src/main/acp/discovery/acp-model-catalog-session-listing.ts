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
import {
  runAgentModelCatalogListing,
  runAgentModelCatalogSession
} from '../../native-chat/agent-model-catalog/agent-model-catalog-probe-runner'
import {
  createAcpAgentConnection,
  type AcpAgentConnectionOptions
} from '../process/acp-agent-connection'
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
import { discardAcpListingSessions } from './acp-listing-session-discard'
import type { ProviderAcquisitionConnection } from '../../provider-process/provider-acquisition-starts'

export type AcpSessionListingResult = {
  models: AgentSessionModelOption[]
  attemptedModels: string[]
}

/** Read a model listing through one disposable chat session and clean up after it exits. */
export function acpSessionModelListing(input: {
  spec: AcpLaunchSpec
  listing: AcpSessionModelDiscovery
  deps: Pick<AcpModelCatalogProbeDeps, 'dataDirectory' | 'connectSession' | 'runListing'>
  launch: ProviderProcessLaunch
  prefixArgs: string[]
  workspace: string
  accountHome: AgentSessionAccountHome
  pluginDirs: readonly string[]
  extensionPath: string | undefined
  connectionOptions: AcpAgentConnectionOptions
  operation: StructuredAgentResolutionOperation | undefined
  selectedModels?: readonly string[]
  publish?: AgentModelCatalogProgress
  run: { label: string; signal?: AbortSignal; timeoutMs: number | null }
  retain: <C extends ProviderAcquisitionConnection>(connection: C) => C
}): (model: string | undefined) => Promise<AcpSessionListingResult> {
  const { spec, listing, deps, launch, prefixArgs, workspace, accountHome } = input
  const { pluginDirs, extensionPath, connectionOptions, operation, publish, run } = input
  const folderArgs = listing.sessionFolderArgs
  // Without a chat's folder, the account's models list in an empty private one.
  const inPrivateFolder = listing.inPrivateFolder || !workspace
  return async (model: string | undefined) => {
    const folder =
      folderArgs || inPrivateFolder
        ? await acpRunFolder(join(deps.dataDirectory, 'acp-listing-sessions', spec.agent))
        : null
    const sessionCwd = inPrivateFolder && folder ? folder.path : workspace
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
          input.retain(
            (deps.connectSession ?? createAcpAgentConnection)(
              { ...launch, args },
              {
                ...connectionOptions,
                onExtensionNotification: (method, params) => {
                  tierReport = readOmpNativeChatOptions(method, params) ?? tierReport
                }
              }
            )
          ),
        (connection, ready) =>
          readSessionModels(
            spec,
            listing,
            connection,
            sessionCwd,
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
      const accountHomePath = agentSessionAccountHomePath(accountHome)
      if (accountHomePath) {
        await discardAcpListingSessions(spec.agent, listing, started, {
          cwd: sessionCwd,
          accountHomePath,
          // Unbounded by the listing's signal: a cancelled listing still discards its session.
          runAgent: (agentArgs) =>
            (deps.runListing ?? runAgentModelCatalogListing)(
              { ...launch, args: [...prefixArgs, ...agentArgs] },
              { site: `${spec.agent}-listing-discard` }
            )
        })
      }
      await folder?.remove()
    }
  }
}
