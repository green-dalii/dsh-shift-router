/**
 * dsh-shift-router — card UX derivation tests
 *
 * The card states facts about the configuration (the threshold a penalty
 * implies, that a tier is empty, that two rows are the same route, what the
 * collapsed header says). Those statements are computed by pure functions so
 * they can be tested: a stock profile shows no plugin logs (SPEC §13), which
 * makes the card the only place these facts are readable.
 */

import { describe, expect, it } from 'vitest'
import {
  ECONOMIC_MODE_PENALTIES,
  chainProblems,
  chainView,
  duplicateRoutes,
  effectiveThreshold,
  summaryFacts,
} from '../src/client/card-ux.js'
import type { FieldState } from '../src/client/controller.js'
import type { ModelRow } from '../src/client/form-model.js'
import { ECONOMIC_MODE_PRESETS } from '../src/router.js'

function row(provider: string, model: string, priority = 1): ModelRow {
  return { provider, model, priority }
}

/** A minimal field state; only the members the derivations read are meaningful. */
function fieldState(path: string, patch: Partial<FieldState>): FieldState {
  return { path, kind: 'scalar', text: '', rows: [], overridden: false, invalid: false, ...patch }
}

function stateByPath(entries: [string, Partial<FieldState>][]): Map<string, FieldState | undefined> {
  return new Map(entries.map(([path, patch]) => [path, fieldState(path, patch)]))
}

describe('effectiveThreshold', () => {
  it('uses the raw penalty when no preset is selected', () => {
    expect(effectiveThreshold({ mode: '', reworkPenalty: 4 })).toBe(0.25)
  })

  it('lets a preset win over the raw penalty', () => {
    // `eco` is R=2 whatever the number field still says: the card must state what
    // the router will do, not what the disabled-looking field says.
    expect(effectiveThreshold({ mode: 'eco', reworkPenalty: 9 })).toBe(0.5)
    expect(effectiveThreshold({ mode: 'sport', reworkPenalty: 1 })).toBe(0.2)
  })

  it('has no threshold for a non-positive or non-numeric penalty', () => {
    expect(effectiveThreshold({ mode: '', reworkPenalty: 0 })).toBeUndefined()
    expect(effectiveThreshold({ mode: '', reworkPenalty: -3 })).toBeUndefined()
    expect(effectiveThreshold({ mode: '', reworkPenalty: Number.NaN })).toBeUndefined()
  })

  it('mirrors the host economics presets', () => {
    // The client bundle cannot import the schema module (schemastery is not a
    // platform seed word), so the two tables are pinned here instead.
    expect(ECONOMIC_MODE_PENALTIES).toEqual(ECONOMIC_MODE_PRESETS)
  })
})

describe('chainProblems', () => {
  it('reports an empty tier, because an empty tier is a disabled tier', () => {
    expect(chainProblems({ fast: [], smart: [row('p', 'm')] })).toEqual([{ kind: 'empty-tier', tier: 'fast' }])
    expect(chainProblems({ fast: [], smart: [] })).toEqual([
      { kind: 'empty-tier', tier: 'fast' },
      { kind: 'empty-tier', tier: 'smart' },
    ])
  })

  it('reports Fast and Smart starting on the same model', () => {
    const same = [row('p', 'm')]
    expect(chainProblems({ fast: same, smart: same })).toEqual([{ kind: 'shared-primary' }])
  })

  it('is quiet when the two tiers differ and both have models', () => {
    expect(chainProblems({ fast: [row('p', 'fast')], smart: [row('p', 'smart')] })).toEqual([])
  })
})

describe('duplicateRoutes', () => {
  it('reports a route listed twice, ignoring rows that are not filled in yet', () => {
    const rows = [row('p', 'm'), row('p', 'm'), row('p', 'other'), row('', ''), row('', '')]
    expect(duplicateRoutes(rows)).toEqual(new Set(['p/m']))
  })
})

describe('summaryFacts', () => {
  it('reads the effective (staged) values', () => {
    const facts = summaryFacts(stateByPath([
      ['enabled', { text: 'true' }],
      ['routing.mode', { text: 'manual' }],
      ['tiers.fast.models', { kind: 'models', rows: [row('p', 'a'), row('p', 'b')] }],
      ['tiers.smart.models', { kind: 'models', rows: [row('p', 'c')] }],
    ]))
    expect(facts).toEqual({ enabled: true, mode: 'manual', fast: 2, smart: 1 })
  })

  it('reports the plugin as disabled only when it is', () => {
    const facts = summaryFacts(stateByPath([
      ['enabled', { text: 'false' }],
      ['routing.mode', { text: 'auto' }],
    ]))
    expect(facts.enabled).toBe(false)
    expect(facts.fast).toBe(0)
  })

  it('leaves the mode unknown rather than inventing one', () => {
    expect(summaryFacts(stateByPath([['enabled', { text: 'true' }]])).mode).toBeUndefined()
  })
})

describe('chainView', () => {
  it('reads the rows the card renders, staged or stored', () => {
    const view = chainView(stateByPath([
      ['tiers.fast.models', { kind: 'models', rows: [row('p', 'a')] }],
      ['tiers.smart.models', { kind: 'models', rows: [] }],
    ]))
    expect(view.fast).toHaveLength(1)
    expect(view.smart).toEqual([])
  })
})
