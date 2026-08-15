/**
 * dsh-shift-router — client settings form model tests
 *
 * The GUI card's staged-edit → section-patch logic is pure and runs in both
 * the browser bundle and this test suite. The cross-check with the host CLI's
 * `CONFIG_FIELDS` keeps the two field registries from drifting: every scalar
 * leaf the CLI editor exposes must be editable in the GUI card too.
 */

import { describe, expect, it } from 'vitest'
import {
  CARD_FIELDS,
  buildPlan,
  deepEqual,
  deletePath,
  formatValue,
  hasPath,
  parseDraft,
  readPath,
  setPath,
  type CardField,
  type StagedDraft,
} from '../src/client/form-model.js'
import { CONFIG_FIELDS } from '../src/commands.js'

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

const numberField: CardField = { path: 'a', section: 'a', key: 'a', type: 'number', labelKey: 'x', hintKey: 'y' }
const boolField: CardField = { path: 'b', section: 'b', key: 'b', type: 'boolean', labelKey: 'x', hintKey: 'y' }
const enumField: CardField = { path: 'c', section: 'c', key: 'c', type: 'enum', enum: ['auto', 'off'], labelKey: 'x', hintKey: 'y' }

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

// ─── save plan ───────────────────────────────────────────────────────

function staged(entries: Record<string, StagedDraft>): Map<string, StagedDraft> {
  return new Map(Object.entries(entries))
}

const snapshot = (partial: Record<string, unknown>) => ({
  value: {
    enabled: true,
    routing: {
      mode: 'auto',
      judgeTimeout: 5000,
      window: { size: 5, threshold: 0.6, minConfidence: 0.5 },
      cacheAware: { enabled: true, sameFamilyThreshold: 0.9, idleBoundaryMs: 300000 },
    },
    orchestration: { mode: 'auto', maxRounds: 3, escalationThreshold: 2, requireSmartModel: true },
  },
  base: {
    enabled: true,
    routing: {
      mode: 'auto',
      judgeTimeout: 5000,
      window: { size: 5, threshold: 0.6, minConfidence: 0.5 },
      cacheAware: { enabled: true, sameFamilyThreshold: 0.9, idleBoundaryMs: 300000 },
    },
    orchestration: { mode: 'auto', maxRounds: 3, escalationThreshold: 2, requireSmartModel: true },
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
})

// ─── registry parity with the CLI editor ─────────────────────────────

describe('GUI/CLI field registry parity', () => {
  it('exposes every scalar CONFIG_FIELDS leaf with matching path and type', () => {
    const gui = new Map(CARD_FIELDS.map((field) => [field.path, field]))
    const scalars = CONFIG_FIELDS.filter((field) => field.type === 'boolean' || field.type === 'number' || field.type === 'enum')
    expect(scalars.length).toBeGreaterThan(0)
    for (const cli of scalars) {
      const card = gui.get(cli.path)
      expect(card, `missing GUI card field for ${cli.path}`).toBeDefined()
      expect(card!.type, `type drift on ${cli.path}`).toBe(cli.type)
      if (cli.enum) expect(card!.enum).toEqual(cli.enum)
    }
  })

  it('does not expose complex fields (model lists / pricing) in the GUI card', () => {
    const complex = CONFIG_FIELDS.filter((field) => field.type === 'modelList' || field.type === 'pricing')
    const gui = new Map(CARD_FIELDS.map((field) => [field.path, field]))
    for (const cli of complex) {
      expect(gui.has(cli.path), `${cli.path} must stay CLI-only for now`).toBe(false)
    }
  })

  it('has one entry per scalar path and no duplicate sections in the display order', () => {
    const paths = CARD_FIELDS.map((field) => field.path)
    expect(new Set(paths).size).toBe(paths.length)
    const sections = new Set(CARD_FIELDS.map((field) => field.section))
    expect(sections.size).toBeGreaterThanOrEqual(4)
  })
})
