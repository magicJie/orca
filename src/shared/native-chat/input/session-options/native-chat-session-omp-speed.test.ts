import { describe, expect, it } from 'vitest'
import type { SessionOptionDescriptor } from '../native-chat-session-options'
import {
  nativeChatOptionValuesLabel,
  nativeChatSessionChoiceLabel,
  sayNativeChatSessionOptionEnglish as say
} from './native-chat-session-option-labels'
import { loneFastTier, speedButtonTiers } from './native-chat-session-speed-tiers'

function ompSpeed(currentValue: string): SessionOptionDescriptor {
  return {
    id: 'serviceTier',
    label: 'Speed',
    category: 'mode',
    kind: {
      type: 'select',
      currentValue,
      choices: [
        { value: 'none', label: 'None' },
        { value: 'auto', label: 'Auto' },
        { value: 'default', label: 'Default' },
        { value: 'flex', label: 'Flex' },
        { value: 'scale', label: 'Scale' },
        { value: 'priority', label: 'Priority' },
        { value: 'ultrafast', label: 'Ultrafast' }
      ]
    },
    valueSource: 'reported',
    transport: 'agent-session',
    settable: true
  }
}

describe('OMP native speed choices', () => {
  it('keeps None as the clear tier and literal Default as a visible pick and pill value', () => {
    const none = ompSpeed('none')
    const tiers = speedButtonTiers(none)
    expect(tiers?.standard).toEqual({ value: 'none', label: 'None' })
    expect(tiers?.tiers.map(({ value }) => value)).toEqual([
      'auto',
      'default',
      'flex',
      'scale',
      'priority',
      'ultrafast'
    ])
    expect(loneFastTier(tiers?.tiers ?? [])).toBeUndefined()
    expect(nativeChatOptionValuesLabel([none], say)).toBe('')
    expect(nativeChatOptionValuesLabel([ompSpeed('default')], say)).toBe('Default')
    expect(
      nativeChatSessionChoiceLabel({ value: 'default', label: 'Default' }, say, 'serviceTier')
    ).toBe('Default')
  })
})
