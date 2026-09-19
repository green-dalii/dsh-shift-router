/**
 * dsh-shift-router — `/router config` editor helpers
 *
 * The numbered field registry, path reading, value formatting, and the
 * user-section flattening used by `get`/`set`/`unset`/`diff` are pure —
 * tested here in isolation.
 */

import { describe, expect, it } from 'vitest'
import {
  CONFIG_FIELDS,
  flattenLeaves,
  formatFieldValue,
  readPath,
  resolveFieldSpec,
} from '../src/commands.js'
import { DEFAULT_CONFIG, type ShiftRouterConfig } from '../src/types.js'

describe('CONFIG_FIELDS registry', () => {
  it('lists every editable leaf with unique dotted paths', () => {
    const paths = CONFIG_FIELDS.map((f) => f.path)
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths).toContain('enabled')
    expect(paths).toContain('routing.judgeTimeout')
    expect(paths).toContain('tiers.fast.models')
    expect(paths).toContain('failover.baseMs')
    expect(paths).toContain('telemetry.callLogCap')
    expect(paths).toContain('pricing')
  })

  it('registry paths all resolve against DEFAULT_CONFIG (no typos)', () => {
    for (const field of CONFIG_FIELDS) {
      const value = readPath(DEFAULT_CONFIG, field.path)
      if (field.optional === true) {
        // Unset is this field's real default (a preset selector, or a legacy
        // knob that must stay inert). It must still read as undefined, never
        // as a stale default that would look like a user override.
        expect(value, `${field.path} is optional`).toBeUndefined()
        continue
      }
      expect(value, field.path).not.toBeUndefined()
    }
  })

  it('exposes the EV economics knobs and hides the removed ones', () => {
    const paths = CONFIG_FIELDS.map((f) => f.path)
    expect(paths).toContain('routing.economics.reworkPenalty')
    expect(paths).toContain('routing.economics.downgradeMemory')
    expect(paths).toContain('routing.economics.mode')
    expect(paths).toContain('routing.cacheAware.sameFamilyPenalty')
    // Removed by the alignment round: they must not linger as editable surface.
    expect(paths).not.toContain('orchestration.requireSmartModel')
    expect(paths).not.toContain('failover.speedWindowSize')
  })

  it('marks the pre-EV knobs as legacy so they are not set by accident', () => {
    const legacy = CONFIG_FIELDS.filter((f) => f.legacy === true).map((f) => f.path)
    expect(legacy.sort()).toEqual([
      'routing.cacheAware.sameFamilyThreshold',
      'routing.window.threshold',
    ])
    for (const field of CONFIG_FIELDS.filter((f) => f.legacy === true)) {
      expect(field.optional, `${field.path} legacy implies optional`).toBe(true)
    }
  })
})

describe('resolveFieldSpec', () => {
  it('resolves a 1-based index into the registry', () => {
    const first = resolveFieldSpec('1')
    expect(first).not.toBeNull()
    expect(first!.path).toBe(CONFIG_FIELDS[0]!.path)
  })

  it('resolves an exact dotted path', () => {
    expect(resolveFieldSpec('routing.judgeTimeout')?.path).toBe('routing.judgeTimeout')
    expect(resolveFieldSpec('tiers.smart.models')?.path).toBe('tiers.smart.models')
  })

  it('rejects out-of-range indexes and unknown paths', () => {
    expect(resolveFieldSpec('0')).toBeNull()
    expect(resolveFieldSpec(String(CONFIG_FIELDS.length + 1))).toBeNull()
    expect(resolveFieldSpec('routing.nope')).toBeNull()
    expect(resolveFieldSpec('')).toBeNull()
  })
})

describe('readPath', () => {
  it('reads nested values and returns undefined for absent paths', () => {
    const cfg: ShiftRouterConfig = structuredClone(DEFAULT_CONFIG)
    expect(readPath(cfg, 'routing.window.size')).toBe(5)
    expect(readPath(cfg, 'tiers.fast.models')).toEqual([])
    expect(readPath(cfg, 'routing.window.doesNotExist')).toBeUndefined()
    expect(readPath(null, 'a.b')).toBeUndefined()
  })
})

describe('formatFieldValue', () => {
  it('formats booleans, numbers, and model lists', () => {
    expect(formatFieldValue(true, 'boolean')).toBe('true')
    expect(formatFieldValue(5000, 'number')).toBe('5000')
    expect(formatFieldValue(
      [{ provider: 'opencode-go', model: 'deepseek-v4-flash' }],
      'modelList',
    )).toBe('opencode-go/deepseek-v4-flash')
    expect(formatFieldValue([], 'modelList')).toBe('(none)')
    expect(formatFieldValue(undefined, 'boolean')).toBe('(unset)')
  })

  it('JSON-stringifies arrays and objects', () => {
    expect(formatFieldValue([{ a: 1 }], 'pricing')).toBe('[{"a":1}]')
  })
})

describe('flattenLeaves', () => {
  it('flattens nested objects to dotted leaf paths', () => {
    const leaves = flattenLeaves({ routing: { window: { size: 3 }, mode: 'auto' }, enabled: true })
    expect(leaves).toEqual([
      { path: 'routing.window.size', value: 3 },
      { path: 'routing.mode', value: 'auto' },
      { path: 'enabled', value: true },
    ])
  })

  it('keeps arrays as leaves (not recursed)', () => {
    const leaves = flattenLeaves({ tiers: { fast: { models: [{ provider: 'p' }] } } })
    expect(leaves).toHaveLength(1)
    expect(leaves[0]!.path).toBe('tiers.fast.models')
  })
})
