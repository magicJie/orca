import { z } from 'zod'
import type { AgentSessionModelOption } from '../../shared/agent-session/options/model-catalog/agent-session-model-option'
import type { AgentSessionOptionsResult } from '../../shared/agent-session/options/protocol/agent-session-options-result'
import type { AcpDialect } from '../acp/acp-dialects/acp-dialect'
import type { AcpOptionWrite } from '../acp/options/acp-structured-options'

const OmpNativeChatOptionsSchema = z.object({
  models: z.array(
    z.object({
      id: z.string().min(1),
      serviceTiers: z.array(
        z.object({
          value: z.string().min(1),
          label: z.string().min(1),
          description: z.string().optional()
        })
      ),
      serviceTier: z.string().min(1).nullable()
    })
  )
})

export type OmpNativeChatOptions = z.infer<typeof OmpNativeChatOptionsSchema>

export function readOmpNativeChatOptions(
  method: string,
  params: unknown
): OmpNativeChatOptions | undefined {
  if (method !== '_orca/omp/options') {
    return undefined
  }
  const result = OmpNativeChatOptionsSchema.safeParse(params)
  return result.success ? result.data : undefined
}

export function withOmpServiceTiers(
  models: AgentSessionModelOption[],
  report: OmpNativeChatOptions | undefined
): AgentSessionModelOption[] {
  if (!report) {
    return models
  }
  return models.map((model) => ({
    ...model,
    serviceTiers: report.models.find((entry) => entry.id === model.id)?.serviceTiers ?? []
  }))
}

export function tierWrite(
  key: string,
  value: string,
  report: OmpNativeChatOptions | undefined,
  current: Readonly<Record<string, string | undefined>>,
  dialect: Pick<AcpDialect, 'serviceTierCommand'>
): AcpOptionWrite | null {
  const command = dialect.serviceTierCommand
  if (key !== 'serviceTier' || !report || !command) {
    return null
  }
  return report.models
    .find((entry) => entry.id === current.model)
    ?.serviceTiers.some((choice) => choice.value === value)
    ? { method: 'command', text: command(value) }
    : null
}

export function currentOmpServiceTier(
  report: OmpNativeChatOptions | undefined,
  modelId: string | undefined
): { serviceTier?: string } {
  const value = report?.models.find((entry) => entry.id === modelId)?.serviceTier
  return value ? { serviceTier: value } : {}
}

export function withOmpServiceTierOptionResult(
  models: AgentSessionModelOption[],
  report: OmpNativeChatOptions | undefined,
  forkSupport: AgentSessionOptionsResult['forkSupport'],
  modelId: string | undefined,
  effort: string | undefined
): Pick<AgentSessionOptionsResult, 'models' | 'current' | 'forkSupport'> {
  const current = {
    ...(modelId ? { model: modelId } : {}),
    ...(effort !== undefined ? { effort } : {}),
    ...currentOmpServiceTier(report, modelId)
  }
  return {
    models: withOmpServiceTiers(models, report),
    forkSupport,
    current: { ...current, confirmed: Object.keys(current) }
  }
}

export function reportedOmpNativeChatOptions(
  current: AgentSessionOptionsResult['current']
): Readonly<Record<string, string>> {
  return {
    ...(current.model ? { model: current.model } : {}),
    ...(current.effort ? { effort: current.effort } : {}),
    ...(current.serviceTier ? { serviceTier: current.serviceTier } : {})
  }
}
