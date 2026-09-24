/**
 * dsh-shift-router — the Judge source's sub-form (SPEC §12.3, §6.4)
 *
 * The Judge has three sources, and each one needs a different sub-form. Showing
 * all of them at once is not merely untidy: it hides which controls are LIVE
 * (`judge.models` does nothing under `fast-chain`), and it invites input that
 * will never be read. The rule therefore lives in the field registry and both
 * readers go through it — the card, to render, and the controller, to decide
 * what a save writes.
 *
 * Three properties are pinned here:
 *
 * 1. **The comparison follows the CONTROL, not the stored config.** Choosing a
 *    mode reveals its sub-form before any save, or the panel would contradict
 *    the select right above it.
 * 2. **Hidden means not written — never deleted.** A save applies what the user
 *    can see; a value already stored for a hidden control stays stored, so
 *    switching a mode back restores it.
 * 3. **No enum reaches a user as a raw token.** `fast-chain` in a dropdown is
 *    how this UX defect started: every value has a translated label and, for the
 *    Judge, an explanation of the consequence it carries.
 */

import { describe, expect, it, vi } from 'vitest'

// The client store is a platform-provided runtime module (it pulls `zustand`),
// so this suite supplies the same contract locally — the visibility logic under
// test is the real one, and the store is not what is being tested here.
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  createSnapshotStore: <T,>(init: T) => {
    let state = init
    const listeners = new Set<() => void>()
    const notify = () => {
      for (const listener of [...listeners]) listener()
    }
    return {
      getSnapshot: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      set: (next: T) => {
        state = next
        notify()
      },
    }
  },
}))

import {
  CARD_FIELDS,
  isFieldVisible,
  publishedFields,
  type CardField,
} from '../src/client/form-model.js'
import { ShiftRouterCardController } from '../src/client/controller.js'
import { en, zh } from '../src/client/locales.js'
import { deepMergeConfig } from '../src/config.js'
import { DEFAULT_CONFIG } from '../src/types.js'

describe('isFieldVisible', () => {
  const gated: CardField = {
    path: 'a.b',
    section: 's',
    display: 'routing',
    key: 'b',
    type: 'string',
    labelKey: 'x',
    hintKey: 'y',
    visibleWhen: { path: 'a.mode', is: ['custom', 'decision'] },
  }

  it('leaves an ungated control alone', () => {
    const { visibleWhen: _drop, ...plain } = gated
    expect(isFieldVisible(plain as CardField, () => undefined)).toBe(true)
  })

  it('matches the listed values only', () => {
    expect(isFieldVisible(gated, () => 'custom')).toBe(true)
    expect(isFieldVisible(gated, () => 'decision')).toBe(true)
    expect(isFieldVisible(gated, () => 'fast-chain')).toBe(false)
    expect(isFieldVisible(gated, () => 'gpt')).toBe(false)
  })

  it('fails closed for an unset or missing control', () => {
    // An unset optional enum reads as `''` — which is the Judge's default
    // (fast-chain) and must show no sub-form at all.
    expect(isFieldVisible(gated, () => '')).toBe(false)
    expect(isFieldVisible(gated, () => undefined)).toBe(false)
    expect(isFieldVisible(gated, () => null)).toBe(false)
    expect(isFieldVisible(gated, () => 7)).toBe(false)
  })
})

describe('registry: the Judge source sub-form', () => {
  const byPath = new Map(CARD_FIELDS.map((field) => [field.path, field]))
  const judgePaths = CARD_FIELDS.filter((field) => field.path.startsWith('routing.judge')).map((f) => f.path)

  it('gates exactly the sub-form each mode needs', () => {
    expect(byPath.get('routing.judge.mode')?.visibleWhen).toBeUndefined()
    expect(byPath.get('routing.judge.models')?.visibleWhen).toEqual({
      path: 'routing.judge.mode',
      is: ['custom'],
    })
    for (const path of [
      'routing.judge.decision.baseUrl',
      'routing.judge.decision.model',
      'routing.judge.decision.apiKeyRef',
    ]) {
      expect(byPath.get(path)?.visibleWhen, path).toEqual({
        path: 'routing.judge.mode',
        is: ['decision'],
      })
    }
    expect(judgePaths.filter((path) => path.startsWith('routing.judge.'))).toHaveLength(5)
    expect(judgePaths).toHaveLength(8)
  })

  it('gates every control on a control that is itself always visible', () => {
    for (const field of CARD_FIELDS) {
      if (field.visibleWhen === undefined) continue
      const target = byPath.get(field.visibleWhen.path)
      expect(target, `${field.path} gates on an unregistered path`).toBeDefined()
      // A gate on a gated control could hide two levels at once, and a gate on a
      // model chain could never match (a chain has no "value" to compare).
      expect(target!.visibleWhen, `${field.path} gates on a gated control`).toBeUndefined()
      expect(target!.type, `${field.path} gates on a ${target!.type}`).toBe('enum')
      // Every value it matches must be one the gating control can actually take,
      // or the sub-form would be unreachable.
      for (const value of field.visibleWhen.is) {
        expect(target!.enum, `${field.path}: "${value}" is not an option`).toContain(value)
      }
    }
  })
})

describe('registry: no enum reaches a user as a raw token', () => {
  const enums = CARD_FIELDS.filter((field) => field.type === 'enum')

  it('has enums to check', () => {
    expect(enums.length).toBeGreaterThanOrEqual(4)
  })

  it('labels every enum value in both languages', () => {
    const dicts = { en, zh }
    for (const field of enums) {
      expect(field.optionLabels, `${field.path} has no option labels`).toBeDefined()
      for (const value of field.enum ?? []) {
        const key = field.optionLabels?.[value]
        expect(key, `${field.path}: value "${value}" has no label`).toBeDefined()
        for (const [name, dict] of Object.entries(dicts)) {
          const text = (dict as Record<string, string>)[key!]
          expect(text, `${field.path}.${value} label missing from ${name}`).toBeDefined()
          expect(text, `${field.path}.${value} label is empty in ${name}`).not.toBe('')
          // The label must not simply restate the token: that is the defect.
          expect(text, `${field.path}.${value} still shows the raw token in ${name}`).not.toBe(value)
        }
      }
    }
  })

  it('explains the Judge modes one by one, in both languages', () => {
    const mode = CARD_FIELDS.find((field) => field.path === 'routing.judge.mode')!
    expect(mode.hintByOption).toBeDefined()
    for (const value of mode.enum ?? []) {
      const key = mode.hintByOption?.[value]
      expect(key, `no explanation for "${value}"`).toBeDefined()
      for (const dict of [en, zh] as Record<string, string>[]) {
        expect(dict[key!], `${value} explanation missing`).toBeDefined()
        expect((dict[key!] ?? '').length, `${value} explanation is too thin`).toBeGreaterThan(40)
      }
    }
    // The field's own hint covers the UNSET state, which is the default.
    expect(mode.hintKey).toBeDefined()
    expect(en[mode.hintKey as keyof typeof en]).toBeDefined()
    expect(zh[mode.hintKey as keyof typeof zh]).toBeDefined()
  })

  it('labels the group headings the Judge sub-forms render under', () => {
    for (const heading of ['g.judgeSource', 'g.judgeDecision']) {
      expect(en[heading as keyof typeof en], heading).toBeDefined()
      expect(zh[heading as keyof typeof zh], heading).toBeDefined()
    }
  })
})

// ─── controller integration ──────────────────────────────────────────

/** The composition layer a field reverts to: defaults, with nothing stored. */
const BASE = deepMergeConfig(DEFAULT_CONFIG, {})

/** A settings scope built from exactly what the controller consumes. */
function fakeScope(initial: Record<string, unknown> = {}) {
  let user: Record<string, unknown> = structuredClone(initial)
  const listeners = new Set<() => void>()
  const merge = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
    for (const [key, value] of Object.entries(source)) {
      const current = target[key]
      if (
        value !== null && typeof value === 'object' && !Array.isArray(value)
        && current !== null && typeof current === 'object' && !Array.isArray(current)
      ) {
        merge(current as Record<string, unknown>, value as Record<string, unknown>)
      } else {
        target[key] = value
      }
    }
  }
  const snapshot = () => {
    const value = structuredClone(BASE) as unknown as Record<string, unknown>
    merge(value, user)
    return { status: 'ready' as const, writable: true, value, base: BASE, user }
  }
  return {
    getSnapshot: snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: async (section: string, value: Record<string, unknown>) => {
      // The real scope replaces the section's user layer with the patch, which
      // is why `buildPlan` builds each section whole.
      user[section] = value
      for (const listener of listeners) listener()
    },
    unset: async (section: string) => {
      delete user[section]
      for (const listener of listeners) listener()
    },
    stored: () => user,
  }
}

/** The field paths the card would render, in order. */
function shown(controller: ShiftRouterCardController): string[] {
  return controller.store.getSnapshot().fields.map((field) => field.path)
}

describe('the card shows one Judge sub-form at a time', () => {
  it('shows only the mode control while the Fast chain judges (the unset default)', () => {
    const controller = new ShiftRouterCardController(fakeScope() as never)
    const paths = shown(controller)
    expect(paths).toContain('routing.judge.mode')
    expect(paths).not.toContain('routing.judge.models')
    expect(paths).not.toContain('routing.judge.decision.baseUrl')
    expect(paths).not.toContain('routing.judge.decision.apiKeyRef')
  })

  it('reveals the dedicated chain the moment "custom" is chosen', () => {
    const controller = new ShiftRouterCardController(fakeScope() as never)
    controller.edit('routing.judge.mode', 'custom')
    const paths = shown(controller)
    expect(paths).toContain('routing.judge.models')
    expect(paths).not.toContain('routing.judge.decision.baseUrl')
  })

  it('reveals the endpoint controls the moment "decision" is chosen', () => {
    const controller = new ShiftRouterCardController(fakeScope() as never)
    controller.edit('routing.judge.mode', 'decision')
    const paths = shown(controller)
    expect(paths).toContain('routing.judge.decision.baseUrl')
    expect(paths).toContain('routing.judge.decision.model')
    expect(paths).toContain('routing.judge.decision.apiKeyRef')
    expect(paths).not.toContain('routing.judge.models')
  })

  it('reads the stored mode too, not just a staged one', () => {
    const controller = new ShiftRouterCardController(
      fakeScope({ routing: { judge: { mode: 'decision' } } }) as never,
    )
    expect(shown(controller)).toContain('routing.judge.decision.baseUrl')
  })

  it('keeps a mode the user moves away from, so switching back restores it', () => {
    const scope = fakeScope({ routing: { judge: { mode: 'decision' } } })
    const controller = new ShiftRouterCardController(scope as never)
    controller.edit('routing.judge.decision.baseUrl', 'https://api.example.test')
    controller.edit('routing.judge.mode', 'custom')
    expect(shown(controller)).not.toContain('routing.judge.decision.baseUrl')
    controller.edit('routing.judge.mode', 'decision')
    expect(shown(controller)).toContain('routing.judge.decision.baseUrl')
    // …and the typed value is still there.
    const baseUrl = controller.store.getSnapshot().fields.find((f) => f.path === 'routing.judge.decision.baseUrl')
    expect(baseUrl?.text).toBe('https://api.example.test')
  })
})

describe('the card renders what the controller publishes', () => {
  it('resolves the registry entries for the published controls, in published order', () => {
    const published = [{ path: 'routing.judge.mode' }, { path: 'tiers.fast.models' }]
    expect(publishedFields(published).map((field) => field.path)).toEqual([
      'routing.judge.mode',
      'tiers.fast.models',
    ])
  })

  it('draws nothing the controller withheld', () => {
    // The regression a browser run caught and these unit tests could not: the
    // card used to walk the whole registry, so a control excluded from the
    // projection was still rendered and the sub-form never actually hid.
    const paths = publishedFields([{ path: 'routing.judge.mode' }]).map((field) => field.path)
    expect(paths).toEqual(['routing.judge.mode'])
    expect(paths).not.toContain('routing.judge.models')
    expect(paths).not.toContain('routing.judge.decision.baseUrl')
  })

  it('survives a published path with no registry entry', () => {
    expect(publishedFields([{ path: 'gone.tomorrow' }])).toEqual([])
  })
})

describe('a control the user cannot see is never written', () => {
  it('does not count a hidden edit as an unsaved change', () => {
    const controller = new ShiftRouterCardController(fakeScope() as never)
    // Stage an edit on a control that the current mode does not show. (This is
    // reachable: type a URL under `decision`, then switch the mode away.)
    controller.edit('routing.judge.decision.baseUrl', 'https://api.example.test')
    controller.edit('routing.judge.mode', 'custom')
    expect(controller.store.getSnapshot().fields.some((f) => f.path === 'routing.judge.decision.baseUrl')).toBe(false)
    // The only unsaved change left is the mode itself.
    expect(controller.store.getSnapshot().dirty).toBe(true)

    // With nothing but the hidden edit staged, the card is NOT dirty: pressing
    // Save would write nothing, so offering it would be a lie.
    const clean = new ShiftRouterCardController(fakeScope() as never)
    clean.edit('routing.judge.decision.baseUrl', 'https://api.example.test')
    expect(clean.store.getSnapshot().dirty).toBe(false)
  })

  it('writes what is visible and leaves the rest of the document alone', async () => {
    const scope = fakeScope()
    const controller = new ShiftRouterCardController(scope as never)
    controller.edit('routing.judge.decision.baseUrl', 'https://api.example.test')
    controller.edit('routing.judge.mode', 'decision')
    await controller.save()
    const stored = scope.stored()
    expect(stored.routing).toBeDefined()
    expect(JSON.stringify(stored)).toContain('https://api.example.test')
    // Nothing was written for the mode that is not selected.
    expect(JSON.stringify(stored)).not.toContain('judge.models')
  })

  it('never deletes a stored value just because its control is hidden', async () => {
    const scope = fakeScope({
      routing: { judge: { mode: 'decision', decision: { baseUrl: 'https://kept.example.test' } } },
    })
    const controller = new ShiftRouterCardController(scope as never)
    controller.edit('routing.judge.mode', 'fast-chain')
    await controller.save()
    // The mode moved; the stored endpoint did NOT get cleared with it.
    const stored = JSON.stringify(scope.stored())
    expect(stored).toContain('https://kept.example.test')
    expect(stored).toContain('fast-chain')
  })
})
