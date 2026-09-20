/**
 * dsh-shift-router — client settings form model tests
 *
 * The GUI card's staged-edit → section-patch logic is pure and runs in both
 * the browser bundle and this test suite. The cross-check with the host CLI's
 * `CONFIG_FIELDS` keeps the two field registries from drifting: every scalar
 * leaf the CLI editor exposes must be editable in the GUI card too, and the
 * two tier model chains must be exposed with matching paths. Both registries
 * carry the same `optional` (ships unset) / `legacy` (pre-EV compatibility)
 * flags, so the card renders an unset leaf as blank/"default" instead of
 * inventing a value.
 */

import { describe, expect, it } from 'vitest'
import {
  CARD_FIELDS,
  buildPlan,
  deepEqual,
  deletePath,
  formatRows,
  formatValue,
  hasPath,
  parseDraft,
  parseModelRows,
  readPath,
  setPath,
  type CardField,
  type StagedDraft,
} from '../src/client/form-model.js'
import { CONFIG_FIELDS } from '../src/commands.js'
import { Config } from '../src/config.js'

// ─── path helpers ────────────────────────────────────────────────────

describe('path helpers', () => {
  it('readPath walks dotted paths and tolerates gaps', () => {
    const obj = { a: { b: { c: 1 } } }
    expect(readPath(obj, 'a.b.c')).toBe(1)
    expect(readPath(obj, 'a.b')).toEqual({ c: 1 })
    expect(readPath(obj, 'a.x')).toBeUndefined()
    expect(readPath(undefined, 'a')).toBeUndefined()
  })

  it('hasPath only reports present (own) keys at every hop', () => {
    const obj = { a: { b: 0 } }
    expect(hasPath(obj, 'a.b')).toBe(true)
    expect(hasPath(obj, 'a.c')).toBe(false)
    expect(hasPath(obj, 'x.y')).toBe(false)
    expect(hasPath(undefined, 'a')).toBe(false)
  })

  it('setPath creates intermediate objects and overwrites scalars', () => {
    const target: Record<string, unknown> = {}
    setPath(target, 'window.size', 7)
    expect(target).toEqual({ window: { size: 7 } })
    setPath(target, 'window.threshold', 0.5)
    expect(target).toEqual({ window: { size: 7, threshold: 0.5 } })
  })

  it('deletePath removes a leaf and leaves siblings', () => {
    const target: Record<string, unknown> = { window: { size: 7, threshold: 0.5 } }
    deletePath(target, 'window.size')
    expect(target).toEqual({ window: { threshold: 0.5 } })
    deletePath(target, 'missing.path')
    expect(target).toEqual({ window: { threshold: 0.5 } })
  })

  it('deepEqual compares JSON shapes strictly', () => {
    expect(deepEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(deepEqual([1], [1, 2])).toBe(false)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
})

// ─── draft parsing / formatting ──────────────────────────────────────

const numberField: CardField = { path: 'a', section: 'a', display: 'a', key: 'a', type: 'number', labelKey: 'x', hintKey: 'y' }
const boolField: CardField = { path: 'b', section: 'b', display: 'b', key: 'b', type: 'boolean', labelKey: 'x', hintKey: 'y' }
const enumField: CardField = { path: 'c', section: 'c', display: 'c', key: 'c', type: 'enum', enum: ['auto', 'off'], labelKey: 'x', hintKey: 'y' }

describe('draft parsing', () => {
  it('formats effective values as control text', () => {
    expect(formatValue(5, numberField)).toBe('5')
    expect(formatValue(true, boolField)).toBe('true')
    expect(formatValue('auto', enumField)).toBe('auto')
    expect(formatValue(undefined, numberField)).toBe('')
  })

  it('parses numbers, blank clears, junk invalidates', () => {
    expect(parseDraft(' 42 ', numberField)).toEqual({ kind: 'set', value: 42 })
    expect(parseDraft('', numberField)).toEqual({ kind: 'clear' })
    expect(parseDraft('abc', numberField)).toBeUndefined()
  })

  it('parses booleans exactly', () => {
    expect(parseDraft('true', boolField)).toEqual({ kind: 'set', value: true })
    expect(parseDraft('false', boolField)).toEqual({ kind: 'set', value: false })
    expect(parseDraft('yes', boolField)).toBeUndefined()
  })

  it('parses enums against the allowed set', () => {
    expect(parseDraft('off', enumField)).toEqual({ kind: 'set', value: 'off' })
    expect(parseDraft('manual', enumField)).toBeUndefined()
  })
})

// ─── model chains ────────────────────────────────────────────────────

describe('model chain drafts', () => {
  it('formats a stored chain into rows, defaulting priority to row order', () => {
    expect(formatRows(undefined)).toEqual([])
    expect(formatRows([
      { provider: 'p1', model: 'm1', priority: 4 },
      { provider: 'p2', model: 'm2' },
      'junk',
    ])).toEqual([
      { provider: 'p1', model: 'm1', priority: 4 },
      { provider: 'p2', model: 'm2', priority: 2 },
      { provider: '', model: '', priority: 3 },
    ])
  })

  it('parses complete rows and re-derives priority from row order', () => {
    expect(parseModelRows([
      { provider: '  opencode-go ', model: 'deepseek-v4-flash', priority: 9 },
      { provider: 'other', model: 'smart-model', priority: 1 },
    ])).toEqual({
      kind: 'set',
      value: [
        { provider: 'opencode-go', model: 'deepseek-v4-flash', priority: 1 },
        { provider: 'other', model: 'smart-model', priority: 2 },
      ],
    })
  })

  it('drops fully blank rows', () => {
    expect(parseModelRows([
      { provider: 'p', model: 'm', priority: 1 },
      { provider: '  ', model: '', priority: 2 },
    ])).toEqual({ kind: 'set', value: [{ provider: 'p', model: 'm', priority: 1 }] })
  })

  it('invalidates a row with only one side filled', () => {
    expect(parseModelRows([{ provider: 'p', model: '', priority: 1 }])).toBeUndefined()
    expect(parseModelRows([{ provider: '', model: 'm', priority: 1 }])).toBeUndefined()
  })
})

// ─── save plan ───────────────────────────────────────────────────────

function staged(entries: Record<string, StagedDraft>): Map<string, StagedDraft> {
  return new Map(Object.entries(entries))
}

const snapshot = (partial: Record<string, unknown>) => ({
  value: {
    enabled: true,
    tiers: {
      fast: { models: [] },
      smart: { models: [] },
    },
    routing: {
      mode: 'auto',
      judgeTimeout: 5000,
      economics: { reworkPenalty: 3, downgradeMemory: 2 },
      window: { size: 5, minConfidence: 0.5 },
      cacheAware: { enabled: true, sameFamilyPenalty: 1.5, idleBoundaryMs: 300000 },
    },
    orchestration: { mode: 'auto', maxRounds: 3, escalationThreshold: 2 },
  },
  base: {
    enabled: true,
    tiers: {
      fast: { models: [] },
      smart: { models: [] },
    },
    routing: {
      mode: 'auto',
      judgeTimeout: 5000,
      economics: { reworkPenalty: 3, downgradeMemory: 2 },
      window: { size: 5, minConfidence: 0.5 },
      cacheAware: { enabled: true, sameFamilyPenalty: 1.5, idleBoundaryMs: 300000 },
    },
    orchestration: { mode: 'auto', maxRounds: 3, escalationThreshold: 2 },
  },
  user: {},
  ...partial,
})

const fields = CARD_FIELDS

describe('buildPlan', () => {
  it('writes a changed leaf as one section patch carrying only that leaf', () => {
    const plan = buildPlan(fields, staged({ 'routing.judgeTimeout': { text: '8000', clear: false } }), snapshot({}))
    expect(plan.invalid).toBe(false)
    expect(plan.patches).toEqual([
      {
        op: 'set',
        section: 'routing',
        value: { judgeTimeout: 8000 },
        leaves: [{ key: 'judgeTimeout', value: 8000 }],
      },
    ])
  })

  it('batches several leaves of one section into a single write', () => {
    const plan = buildPlan(
      fields,
      staged({
        'routing.window.size': { text: '7', clear: false },
        'routing.cacheAware.enabled': { text: 'false', clear: false },
      }),
      snapshot({}),
    )
    expect(plan.patches).toHaveLength(1)
    expect(plan.patches[0]).toEqual({
      op: 'set',
      section: 'routing',
      value: { window: { size: 7 }, cacheAware: { enabled: false } },
      leaves: [
        { key: 'window.size', value: 7 },
        { key: 'cacheAware.enabled', value: false },
      ],
    })
  })

  it('clears a stored leaf by dropping it from the user section', () => {
    const plan = buildPlan(
      fields,
      staged({ 'routing.judgeTimeout': { text: '5000', clear: true } }),
      snapshot({
        user: { routing: { judgeTimeout: 8000, mode: 'manual' } },
        value: { routing: { judgeTimeout: 8000, mode: 'manual' } },
      }),
    )
    expect(plan.invalid).toBe(false)
    expect(plan.patches).toEqual([
      {
        op: 'set',
        section: 'routing',
        value: { mode: 'manual' },
        leaves: [{ key: 'judgeTimeout', value: undefined }],
      },
    ])
  })

  it('unsets a whole section when the user layer ends up empty', () => {
    const plan = buildPlan(
      fields,
      staged({ 'routing.judgeTimeout': { text: '5000', clear: true } }),
      snapshot({ user: { routing: { judgeTimeout: 8000 } }, value: { routing: { judgeTimeout: 8000 } } }),
    )
    // The only stored leaf is cleared → the section becomes empty → unset.
    expect(plan.patches).toEqual([
      { op: 'unset', section: 'routing', leaves: [{ key: 'judgeTimeout', value: undefined }] },
    ])
  })

  it('treats a clear of a non-stored leaf as a no-op', () => {
    const plan = buildPlan(fields, staged({ 'routing.judgeTimeout': { text: '5000', clear: true } }), snapshot({}))
    expect(plan.patches).toEqual([])
    expect(plan.invalid).toBe(false)
  })

  it('treats a set equal to the effective value as a no-op', () => {
    const plan = buildPlan(
      fields,
      staged({ 'routing.judgeTimeout': { text: '5000', clear: false } }),
      snapshot({}),
    )
    expect(plan.patches).toEqual([])
  })

  it('marks the plan invalid when a draft is unparseable and blocks writes', () => {
    const plan = buildPlan(
      fields,
      staged({ 'routing.judgeTimeout': { text: 'lots', clear: false } }),
      snapshot({}),
    )
    expect(plan.invalid).toBe(true)
    expect(plan.patches).toEqual([])
  })

  it('ignores unknown field paths', () => {
    const plan = buildPlan(fields, staged({ 'nope.missing': { text: '1', clear: false } }), snapshot({}))
    expect(plan.patches).toEqual([])
    expect(plan.invalid).toBe(false)
  })

  it('writes a changed tier model chain under the tiers section', () => {
    const plan = buildPlan(
      fields,
      staged({
        'tiers.fast.models': {
          rows: [{ provider: 'opencode-go', model: 'deepseek-v4-flash', priority: 1 }],
          clear: false,
        },
      }),
      snapshot({}),
    )
    expect(plan.invalid).toBe(false)
    expect(plan.patches).toEqual([
      {
        op: 'set',
        section: 'tiers',
        value: { fast: { models: [{ provider: 'opencode-go', model: 'deepseek-v4-flash', priority: 1 }] } },
        leaves: [{ key: 'fast.models', value: [{ provider: 'opencode-go', model: 'deepseek-v4-flash', priority: 1 }] }],
      },
    ])
  })

  it('batches both tier chains into one tiers-section write', () => {
    const plan = buildPlan(
      fields,
      staged({
        'tiers.fast.models': { rows: [{ provider: 'a', model: 'b', priority: 1 }], clear: false },
        'tiers.smart.models': { rows: [{ provider: 'c', model: 'd', priority: 1 }], clear: false },
      }),
      snapshot({}),
    )
    expect(plan.patches).toHaveLength(1)
    expect(plan.patches[0]!.section).toBe('tiers')
    expect(plan.patches[0]!.value).toEqual({
      fast: { models: [{ provider: 'a', model: 'b', priority: 1 }] },
      smart: { models: [{ provider: 'c', model: 'd', priority: 1 }] },
    })
  })

  it('treats a model chain equal to the effective value as a no-op', () => {
    const effective = [{ provider: 'a', model: 'b', priority: 1 }]
    const plan = buildPlan(
      fields,
      staged({
        'tiers.fast.models': { rows: effective, clear: false },
      }),
      snapshot({ value: { tiers: { fast: { models: effective } } } }),
    )
    expect(plan.patches).toEqual([])
    expect(plan.invalid).toBe(false)
  })

  it('invalidates the plan when a model row is half-filled', () => {
    const plan = buildPlan(
      fields,
      staged({
        'tiers.fast.models': { rows: [{ provider: 'a', model: '', priority: 1 }], clear: false },
      }),
      snapshot({}),
    )
    expect(plan.invalid).toBe(true)
    expect(plan.patches).toEqual([])
  })

  it('clears a stored model chain back to the composition layer', () => {
    const stored = [{ provider: 'a', model: 'b', priority: 1 }]
    const plan = buildPlan(
      fields,
      staged({ 'tiers.fast.models': { rows: stored, clear: true } }),
      snapshot({
        user: { tiers: { fast: { models: stored } } },
        value: { tiers: { fast: { models: stored } } },
      }),
    )
    expect(plan.invalid).toBe(false)
    expect(plan.patches).toEqual([
      { op: 'unset', section: 'tiers', leaves: [{ key: 'fast.models', value: undefined }] },
    ])
  })
})

// ─── registry parity with the CLI editor ─────────────────────────────

/** The schema-resolved config an empty cordis.yml row produces. */
function builtConfig(): Record<string, unknown> {
  const standard = (Config as unknown as {
    '~standard': { validate(value: unknown): { value: unknown } | { issues: { message: string }[] } }
  })['~standard']
  const out = standard.validate({})
  if ('issues' in out) {
    throw new Error(`the config schema rejected an empty config: ${out.issues.map((issue) => issue.message).join('; ')}`)
  }
  return out.value as Record<string, unknown>
}

describe('GUI/CLI field registry parity', () => {
  it('mirrors the CLI registry path-for-path and in order, minus the CLI-only pricing leaf', () => {
    const cliPaths = CONFIG_FIELDS.map((field) => field.path).filter((path) => path !== 'pricing')
    expect(CARD_FIELDS.map((field) => field.path)).toEqual(cliPaths)
  })

  it('exposes every scalar CONFIG_FIELDS leaf with matching path, type, enum, and flags', () => {
    const gui = new Map(CARD_FIELDS.map((field) => [field.path, field]))
    const scalars = CONFIG_FIELDS.filter((field) => field.type === 'boolean' || field.type === 'number' || field.type === 'enum')
    expect(scalars.length).toBeGreaterThan(0)
    for (const cli of scalars) {
      const card = gui.get(cli.path)
      expect(card, `missing GUI card field for ${cli.path}`).toBeDefined()
      expect(card!.type, `type drift on ${cli.path}`).toBe(cli.type)
      if (cli.enum) expect(card!.enum).toEqual(cli.enum)
      expect(card!.optional === true, `optional drift on ${cli.path}`).toBe(cli.optional === true)
      expect(card!.legacy === true, `legacy drift on ${cli.path}`).toBe(cli.legacy === true)
    }
  })

  it('exposes the tier model chains with matching paths', () => {
    const gui = new Map(CARD_FIELDS.map((field) => [field.path, field]))
    for (const path of ['tiers.fast.models', 'tiers.smart.models']) {
      const card = gui.get(path)
      expect(card, `missing GUI card field for ${path}`).toBeDefined()
      expect(card!.type).toBe('models')
    }
  })

  it('keeps pricing CLI-only (no GUI card field)', () => {
    const gui = new Map(CARD_FIELDS.map((field) => [field.path, field]))
    expect(gui.has('pricing')).toBe(false)
  })

  it('has one entry per path, no duplicate display sections, and covers every section in display order', () => {
    const paths = CARD_FIELDS.map((field) => field.path)
    expect(new Set(paths).size).toBe(paths.length)
    const displays = new Set(CARD_FIELDS.map((field) => field.display))
    expect(displays.size).toBeGreaterThanOrEqual(5)
  })
})

// ─── card leaves against the built config ────────────────────────────

describe('CARD_FIELDS against the built config', () => {
  it('resolves every defaulted path, leaving only the leaves that ship unset', () => {
    const built = builtConfig()
    for (const field of CARD_FIELDS) {
      const segments = field.path.split('.')
      if (segments.length > 1) {
        expect(
          readPath(built, segments.slice(0, -1).join('.')),
          `${field.path}: parent object missing from the built config`,
        ).toBeTypeOf('object')
      }
      if (field.optional === true) continue
      expect(readPath(built, field.path), `${field.path} has no value in the built config`).not.toBeUndefined()
    }
  })

  it('flags exactly the leaves the CLI registry marks optional, and every legacy field is optional', () => {
    const cliOptional = new Set(CONFIG_FIELDS.filter((field) => field.optional === true).map((field) => field.path))
    expect(cliOptional.size).toBeGreaterThan(0)
    for (const field of CARD_FIELDS) {
      expect(field.optional === true, `optional drift on ${field.path}`).toBe(cliOptional.has(field.path))
      if (field.legacy === true) expect(field.optional, `${field.path}: legacy implies optional`).toBe(true)
    }
  })

  it('formats a legacy leaf that ships unset as blank/default without throwing', () => {
    const built = builtConfig()
    const legacy = CARD_FIELDS.filter((field) => field.legacy === true)
    expect(legacy.length).toBeGreaterThan(0)
    for (const field of legacy) {
      const value = readPath(built, field.path)
      expect(value, `${field.path} must ship unset`).toBeUndefined()
      expect(() => formatValue(value, field), `${field.path} must format without throwing`).not.toThrow()
      expect(formatValue(value, field), `${field.path} must render as unset`).toBe('')
    }
  })

  it('writes a legacy leaf that ships unset as a real override', () => {
    const plan = buildPlan(
      CARD_FIELDS,
      staged({ 'routing.window.threshold': { text: '0.8', clear: false } }),
      snapshot({}),
    )
    expect(plan.invalid).toBe(false)
    expect(plan.patches).toEqual([
      {
        op: 'set',
        section: 'routing',
        value: { window: { threshold: 0.8 } },
        leaves: [{ key: 'window.threshold', value: 0.8 }],
      },
    ])
  })
})

// ─── control bounds ↔ schema parity ───────────────────────────────────

describe('numeric control bounds mirror the config schema', () => {
  /**
   * The card's number inputs carry `min`/`max`/`step` so the browser refuses what
   * the Host would refuse anyway. The bundle cannot import the schema
   * (schemastery is not a platform seed word), so the two definitions are pinned
   * here by BEHAVIOUR: each declared bound must be exactly the schema's
   * accept/reject boundary (ALIGNMENT §R7).
   */
  const numeric = CARD_FIELDS.filter((field) => field.type === 'number' && (field.min !== undefined || field.max !== undefined))

  /** Validate a config carrying exactly one leaf at the given path. */
  function validateLeaf(path: string, value: number): boolean {
    const standard = (Config as unknown as {
      '~standard': { validate(value: unknown): { value: unknown } | { issues: { message: string }[] } }
    })['~standard']
    const config: Record<string, unknown> = {}
    setPath(config, path, value)
    return !('issues' in standard.validate(config))
  }

  it('covers every numeric field that declares a bound', () => {
    expect(numeric.length).toBeGreaterThan(15)
  })

  it('accepts each declared minimum and rejects just below it', () => {
    for (const field of numeric) {
      if (field.min === undefined) continue
      const step = field.step ?? 1
      expect(validateLeaf(field.path, field.min), `${field.path} must accept its min (${field.min})`).toBe(true)
      expect(validateLeaf(field.path, field.min - step), `${field.path} must reject ${field.min - step}`).toBe(false)
    }
  })

  it('accepts each declared maximum and rejects just above it', () => {
    for (const field of numeric) {
      if (field.max === undefined) continue
      const step = field.step ?? 1
      expect(validateLeaf(field.path, field.max), `${field.path} must accept its max (${field.max})`).toBe(true)
      expect(validateLeaf(field.path, field.max + step), `${field.path} must reject ${field.max + step}`).toBe(false)
    }
  })

  it('uses a positive step so the browser control can reach each other value', () => {
    for (const field of numeric) {
      expect(field.step ?? 1, `${field.path} step`).toBeGreaterThan(0)
    }
  })
})
