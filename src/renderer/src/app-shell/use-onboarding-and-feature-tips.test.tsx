// @vitest-environment happy-dom

import { act, type JSX } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getDefaultOnboardingState } from '../../../shared/onboarding-defaults'
import { createGlobalSettingsFixture } from '../../../shared/global-settings-test-fixture'
import type { ChatUiLaunchTipVariant } from '../../../shared/native-chat/chat-ui-launch-tip-audience'
import type { FeatureTipSeenId } from '../../../shared/feature-tips'
import type { TelemetrySettings } from '../../../shared/telemetry-settings-types'
import { useAppStore } from '@/store'
import { useOnboardingAndFeatureTips } from './use-onboarding-and-feature-tips'

vi.mock('@/diagnostics/telemetry/telemetry', () => ({ track: vi.fn() }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

function Gate(): JSX.Element | null {
  const gate = useOnboardingAndFeatureTips()
  if (gate.onboarding === null) {
    gate.applyStartupOnboardingState({ ...getDefaultOnboardingState(), closedAt: 1 })
  }
  return <output>{String(gate.chatUiHereCornerCardOpen)}</output>
}

type Launch = {
  surface?: 'terminal' | 'chat'
  variant?: ChatUiLaunchTipVariant
  seen?: FeatureTipSeenId[]
  telemetry?: Partial<TelemetrySettings>
}

/** By default, a control an earlier build held back: suppressing it already marked the older ids seen. */
const PRIOR_CONTROL: Partial<TelemetrySettings> = {
  chatUiLaunchTipCohort: 'control',
  chatUiLaunchTipRolloutCohort: 'control',
  chatUiLaunchTipPriorControl: true
}

async function launch({
  surface = 'terminal',
  variant = 'chat-ui-off',
  seen = ['chat-ui-here', 'chat-ui-here-rollout-v1'],
  telemetry = PRIOR_CONTROL
}: Launch = {}): Promise<boolean> {
  vi.mocked(window.api.onboarding.getChatUiLaunchTipVariant).mockResolvedValue(variant)
  useAppStore.setState({
    persistedUIReady: true,
    featureTipsSeenIds: seen,
    settings: createGlobalSettingsFixture({
      agentDefaultSurface: surface,
      aiVaultSearch: { enabled: true, historyDays: null },
      telemetry: {
        optedIn: true,
        installId: 'install',
        existedBeforeTelemetryRelease: true,
        ...telemetry
      }
    })
  })
  await act(async () => root.render(<Gate />))
  return container.querySelector('output')?.textContent === 'true'
}

function expectNextTipInstead(): void {
  expect(useAppStore.getState().modalData).toMatchObject({ tipId: 'cmd-j-palette' })
}

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true)
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      ui: { set: vi.fn().mockResolvedValue(undefined) },
      cli: { getInstallStatus: vi.fn().mockResolvedValue({ supported: false }) },
      onboarding: { getChatUiLaunchTipVariant: vi.fn() }
    }
  })
  container = document.createElement('div')
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
})

it('shows the Chat UI card to a prior control on the terminal', async () => {
  expect(await launch()).toBe(true)
  expect(useAppStore.getState().featureTipsSeenIds).toContain('chat-ui-here-rollout-v2')
})

it('keeps a prior control already on Chat UI out for good', async () => {
  expect(await launch({ surface: 'chat' })).toBe(false)
  expect(useAppStore.getState().featureTipsSeenIds).toContain('chat-ui-here-rollout-v2')
  expectNextTipInstead()
})

it('keeps a prior control that switched back from Chat UI out', async () => {
  expect(await launch({ variant: 'chat-ui-on' })).toBe(false)
  expectNextTipInstead()
})

it('does not show the card again after a prior control is later promoted to treatment', async () => {
  expect(
    await launch({
      seen: ['chat-ui-here', 'chat-ui-here-rollout-v2'],
      telemetry: {
        ...PRIOR_CONTROL,
        chatUiLaunchTipRolloutCohort: 'treatment',
        chatUiLaunchTipTargeting: { mode: 'all' }
      }
    })
  ).toBe(false)
  expectNextTipInstead()
})

it('keeps a control drawn by this build held back', async () => {
  expect(
    await launch({ seen: [], telemetry: { ...PRIOR_CONTROL, chatUiLaunchTipPriorControl: false } })
  ).toBe(false)
  expectNextTipInstead()
})

it('fails closed for a profile with no cohort', async () => {
  expect(await launch({ seen: [], telemetry: {} })).toBe(false)
  expectNextTipInstead()
})

it('fails closed for a cohort this build does not know', async () => {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: simulates a value a newer build saved, which this build's type cannot name.
  const unknown = 'treatment-v9' as TelemetrySettings['chatUiLaunchTipCohort']
  expect(await launch({ seen: [], telemetry: { chatUiLaunchTipCohort: unknown } })).toBe(false)
  expectNextTipInstead()
})

it('still shows the card to a treatment arm', async () => {
  expect(
    await launch({
      seen: [],
      telemetry: {
        chatUiLaunchTipRolloutCohort: 'treatment',
        chatUiLaunchTipTargeting: { mode: 'all' }
      }
    })
  ).toBe(true)
})
