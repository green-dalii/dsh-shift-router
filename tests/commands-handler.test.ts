/**
 * dsh-shift-router — command handler tests
 *
 * `registerCommands()` is the plugin's whole user-facing surface, and its
 * handlers were previously untested (only the field registry helpers were).
 * These tests drive the handlers directly through a fake `CommandDeps`, so a
 * regression in `/router eco|default|sport`, `/router on|off`,
 * `/router orchestrate`, `/router status` or `/route-force` fails here instead
 * of only being noticed in a terminal.
 *
 * The gear presets are the interesting ones: they must PERSIST through the
 * settings namespace (not mutate a frozen config object in place), which is
 * exactly the upstream bug v1.4.0 fixed.
 */

import { describe, expect, it } from 'vitest'
import { registerCommands, type CommandDeps } from '../src/commands.js'
import { createRouterState } from '../src/router.js'
import { DEFAULT_CONFIG, type ShiftRouterConfig, type RouterState } from '../src/types.js'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'

const AGENT = {} as Agent

function invoke(rawInput: string): CommandInvocation {
  return {
    commandId: 'test',
    agent: AGENT,
    rawInput,
    signal: new AbortController().signal,
  } as unknown as CommandInvocation
}

interface Harness {
  deps: CommandDeps
  config: ShiftRouterConfig
  state: RouterState
  /** Every settings patch the commands persisted, in order. */
  patches: Record<string, unknown>[]
  /** Every path-op batch the commands sent. */
  ops: readonly unknown[][]
  /** How many times a handler asked the plugin to re-read its config. */
  configChanged(): number
}

/** Deep-merge `source` into `target` (arrays replace), mirroring settings. */
function deepAssign(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key]
    if (
      value !== null && typeof value === 'object' && !Array.isArray(value)
      && current !== null && typeof current === 'object' && !Array.isArray(current)
    ) {
      deepAssign(current as Record<string, unknown>, value as Record<string, unknown>)
    } else {
      target[key] = value
    }
  }
}

function harness(overrides: Partial<ShiftRouterConfig> = {}): Harness {
  const config = Object.assign(structuredClone(DEFAULT_CONFIG), overrides)
  const state = createRouterState()
  const patches: Record<string, unknown>[] = []
  const ops: readonly unknown[][] = []
  let changes = 0
  const deps: CommandDeps = {
    getConfig: () => config,
    getState: () => state,
    onConfigChanged: () => { changes += 1 },
    setManualOverrideTier: (_agent, tier) => { state.manualOverride = { active: true, tier } },
    setManualOverrideModel: (_agent, provider, modelId) => { state.manualOverride = { active: true, provider, modelId } },
    clearManualOverride: () => { state.manualOverride = { active: false } },
    subagentAvailable: () => true,
    updateSettings: async (patch) => {
      patches.push(patch)
      // The real settings write lands in this namespace, so mirror it: a test
      // that reads back the config afterwards must see the write.
      deepAssign(config as unknown as Record<string, unknown>, patch)
      return null
    },
    resetSettings: async () => null,
    mutateSettings: async (batch) => { ops.push(batch as unknown[]); return null },
    userSettings: () => undefined,
    listProviders: () => ['fake'],
    listModels: async () => ['fake-fast', 'fake-smart'],
  }
  return { deps, config, state, patches, ops, configChanged: () => changes }
}

/** Run one `/router ...` invocation against a harness. */
async function router(h: Harness, input: string) {
  const definition = registerCommands(h.deps).find((d) => d.name === 'router')!
  return definition.handler(invoke(input))
}

async function routeForce(h: Harness, input: string) {
  const definition = registerCommands(h.deps).find((d) => d.name === 'route-force')!
  return definition.handler(invoke(input))
}

describe('gear presets', () => {
  it('persists the chosen gear instead of only mutating memory', async () => {
    for (const gear of ['eco', 'default', 'sport'] as const) {
      const h = harness()
      const result = await router(h, gear)
      expect(result.kind, gear).toBe('success')
      // The whole point: a gear is a durable preference.
      expect(h.patches, gear).toEqual([{ routing: { economics: { mode: gear } } }])
      expect((result as { text: string }).text).toContain(gear)
    }
  })

  it('reports R and theta so the effect is legible', async () => {
    const h = harness()
    const text = ((await router(h, 'eco')) as { text: string }).text
    expect(text).toContain('R=2')
    expect(text).toContain('θ=0.50')
    // Both tiers are empty here, so no cache divisor applies.
    expect(text).not.toContain('cache divisor')
  })

  it('surfaces a persistence failure instead of pretending it worked', async () => {
    const h = harness()
    h.deps.updateSettings = async () => 'schema rejected the value'
    const result = await router(h, 'sport')
    expect(result.kind).toBe('error')
    expect((result as { text: string }).text).toContain('schema rejected the value')
  })
})

describe('toggles', () => {
  it('turns routing on and off session-scoped (no settings write)', async () => {
    const h = harness()
    await router(h, 'off')
    expect(h.config.enabled).toBe(false)
    expect(h.patches).toEqual([])
    await router(h, 'on')
    expect(h.config.enabled).toBe(true)
  })

  it('toggles verbose logging', async () => {
    const h = harness()
    await router(h, 'verbose')
    expect(h.config.ux.routerLogVerbose).toBe(true)
    await router(h, 'log')
    expect(h.config.ux.routerLogVerbose).toBe(false)
  })

  it('sets the orchestration mode and clears an active run when turned off', async () => {
    const h = harness()
    h.state.orchestration.active = true
    h.state.orchestration.rounds = 2
    await router(h, 'orchestrate off')
    expect(h.config.orchestration.mode).toBe('off')
    expect(h.state.orchestration.active).toBe(false)
    expect(h.state.orchestration.rounds).toBe(0)

    await router(h, 'orchestrate auto')
    expect(h.config.orchestration.mode).toBe('auto')
  })

  it('explains the usage when orchestrate is given no argument', async () => {
    const h = harness()
    const text = ((await router(h, 'orchestrate')) as { text: string }).text
    expect(text).toContain('auto|off')
  })
})

describe('/router status', () => {
  it('shows the gear, the last decision and the running model', async () => {
    const h = harness()
    h.config.tiers.fast.models = [{ provider: 'p1', model: 'f', priority: 1 }]
    h.config.tiers.smart.models = [{ provider: 'p2', model: 's', priority: 1 }]
    h.state.currentTier = 'smart'
    h.state.currentModelId = 's'
    h.state.currentProvider = 'p2'
    h.state.actualModel = 's'
    h.state.actualProvider = 'p2'
    h.state.lastDecision = {
      verdictTier: 'smart', confidence: 0.9, reason: 'architecture',
      action: 'upgrade', decisionTier: 'smart', held: false, at: 1,
    }

    const text = ((await router(h, 'status')) as { text: string }).text
    expect(text).toContain('Gear:')
    expect(text).toContain('R=3')
    expect(text).toContain('Running model: p2/s')
    expect(text).toContain('architecture')
    expect(text).not.toContain('tok/s') // throughput belongs to the harness
  })

  it('explains a hold rather than showing an unexplained stay', async () => {
    const h = harness()
    h.state.currentTier = 'smart'
    h.state.lastDecision = {
      verdictTier: 'fast', action: 'stay', decisionTier: 'smart', held: true, at: 1,
    }
    const text = ((await router(h, 'status')) as { text: string }).text
    expect(text).toContain('🅷 hold')
  })

  it('warns when a legacy override is in force', async () => {
    const h = harness()
    h.config.routing.window.threshold = 0.9
    const text = ((await router(h, 'status')) as { text: string }).text
    expect(text).toContain('legacy override')
    expect(text).toContain('routing.window.threshold=0.9')
  })

  it('stays silent for the INERT legacy window threshold default', async () => {
    // 0.6 is the pre-EV default: a config still carrying it is a wizard
    // snapshot, not an override.
    const h = harness()
    h.config.routing.window.threshold = 0.6
    const text = ((await router(h, 'status')) as { text: string }).text
    expect(text).not.toContain('legacy override')
  })

  it('stays silent for the INERT legacy cache-threshold default', async () => {
    // 0.9 is the pre-EV default here too — reporting it would claim a cache
    // divisor that `sameFamilyThetaFactor` does not apply.
    const h = harness()
    h.config.routing.cacheAware!.sameFamilyThreshold = 0.9
    const text = ((await router(h, 'status')) as { text: string }).text
    expect(text).not.toContain('legacy override')
  })

  it('reports a NON-default cache threshold as the legacy override it is', async () => {
    const h = harness()
    h.config.routing.cacheAware!.sameFamilyThreshold = 0.95
    const text = ((await router(h, 'status')) as { text: string }).text
    expect(text).toContain('legacy override')
    expect(text).toContain('sameFamilyThreshold=0.95')
  })

  it('explains a downgradeMemory that exceeds the decision window', async () => {
    const h = harness()
    h.config.routing.window.size = 5
    h.config.routing.economics.downgradeMemory = 6
    const text = ((await router(h, 'status')) as { text: string }).text
    expect(text).toContain('exceeds routing.window.size')
    expect(text).toContain('capped to 5')
  })

  it('errors when there is no router state (subagents are not routed)', async () => {
    const h = harness()
    h.deps.getState = () => undefined
    expect((await router(h, 'status')).kind).toBe('error')
  })
})

describe('/route-force', () => {
  it('sets a tier override', async () => {
    const h = harness()
    await routeForce(h, 'smart')
    expect(h.state.manualOverride).toEqual({ active: true, tier: 'smart' })
  })

  it('sets an exact provider/model override', async () => {
    const h = harness()
    await routeForce(h, 'p9/forced-1')
    expect(h.state.manualOverride).toEqual({ active: true, provider: 'p9', modelId: 'forced-1' })
  })

  it('clears the override on auto and on empty input', async () => {
    const h = harness()
    h.state.manualOverride = { active: true, tier: 'fast' }
    await routeForce(h, 'auto')
    expect(h.state.manualOverride.active).toBe(false)

    h.state.manualOverride = { active: true, tier: 'fast' }
    await routeForce(h, '')
    expect(h.state.manualOverride.active).toBe(false)
  })

  it('rejects an unknown target with an error', async () => {
    const h = harness()
    const result = await routeForce(h, 'sideways')
    expect(result.kind).toBe('error')
  })
})

describe('/router config', () => {
  it('lists every registry field with its current value', async () => {
    const h = harness()
    const text = ((await router(h, 'config')) as { text: string }).text
    expect(text).toContain('routing.economics.reworkPenalty')
    expect(text).toContain('routing.cacheAware.sameFamilyPenalty')
    // Legacy fields are listed but annotated, and ship unset.
    expect(text).toContain('⚠ legacy')
    expect(text).toContain('(unset)')
    // Removed knobs must not reappear in the editor.
    expect(text).not.toContain('requireSmartModel')
    expect(text).not.toContain('speedWindowSize')
  })

  it('writes a scalar through the settings namespace', async () => {
    const h = harness()
    const result = await router(h, 'config set routing.economics.reworkPenalty 5')
    expect(result.kind).toBe('success')
    expect(h.patches).toEqual([{ routing: { economics: { reworkPenalty: 5 } } }])
  })

  it('unsets a leaf with a path operation (the only way to clear an override)', async () => {
    const h = harness()
    const result = await router(h, 'config unset routing.window.threshold')
    expect(result.kind).toBe('success')
    expect(h.ops).toHaveLength(1)
  })

  it('reports how to get help when settings are unavailable', async () => {
    const h = harness()
    h.deps.updateSettings = async () => 'settings service is unavailable — edit the profile cordis.patch.yml row instead'
    const result = await router(h, 'config set enabled true')
    expect(result.kind).toBe('error')
    expect((result as { text: string }).text).toContain('cordis.patch.yml')
  })
})

describe('default invocation', () => {
  it('renders a compact status line', async () => {
    const h = harness()
    h.state.currentTier = 'fast'
    h.state.currentModelId = 'f'
    const text = ((await router(h, '') as { text: string }).text)
    expect(text).toContain('dsh-shift-router')
  })
})

describe('handler wiring', () => {
  it('registers both commands and leaves config untouched on a status read', async () => {
    const h = harness()
    expect(registerCommands(h.deps).map((d) => d.name).sort()).toEqual(['route-force', 'router'])
    const snapshot = JSON.stringify(h.config)
    await router(h, 'status')
    expect(JSON.stringify(h.config)).toBe(snapshot)
    expect(h.patches).toEqual([])
    expect(h.configChanged()).toBe(0)
  })

  it('tells the plugin to re-read config on a toggle, but not on a settings write', async () => {
    const toggled = harness()
    await router(toggled, 'off')
    expect(toggled.configChanged()).toBe(1)

    // A gear goes through the settings namespace, whose watch refreshes config;
    // it must not ALSO poke the in-memory source.
    const geared = harness()
    await router(geared, 'eco')
    expect(geared.configChanged()).toBe(0)
  })
})
