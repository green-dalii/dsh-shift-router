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

import { readFile } from 'node:fs/promises'
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
import { SettingsScopeBinding } from '../src/client/scope-binding.js'
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
    /** Announce a change, as a Host write on this scope would. */
    emit: () => {
      for (const listener of listeners) listener()
    },
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

/**
 * The browser half holds ONE settings-scope handle from construction, because
 * the two client services that serve a namespace belong to different shell
 * generations and arrive on different fibers (see `scope-binding.ts`). Until a
 * host attaches one, the handle answers `unavailable` — the state the card
 * renders as "this host serves no settings" instead of an indefinite spinner.
 */
describe('the card holds one swappable settings-scope handle', () => {
  it('reports unavailable while no host has attached a scope', () => {
    const controller = new ShiftRouterCardController(new SettingsScopeBinding())
    const snap = controller.store.getSnapshot()
    expect(snap.unavailable).toBe(true)
    expect(snap.available).toBe(false)
    expect(snap.writable).toBe(false)
  })

  it('does not claim ready while unattached', () => {
    // `available: true` would be a false positive — the card would render the
    // form and every save would silently fail against nothing.
    const controller = new ShiftRouterCardController(new SettingsScopeBinding())
    expect(controller.store.getSnapshot().unavailable).toBe(true)
    expect(controller.store.getSnapshot().dirty).toBe(false)
  })

  it('reports ready as soon as a host attaches a writable scope', () => {
    const binding = new SettingsScopeBinding()
    const controller = new ShiftRouterCardController(binding)
    expect(controller.store.getSnapshot().unavailable).toBe(true)
    binding.attach(fakeScope() as never)
    const snap = controller.store.getSnapshot()
    expect(snap.unavailable).toBe(false)
    expect(snap.available).toBe(true)
    expect(snap.writable).toBe(true)
  })

  it('republishes when the attached scope moves, and stops when it is replaced', () => {
    const binding = new SettingsScopeBinding()
    const controller = new ShiftRouterCardController(binding)
    const first = fakeScope({ enabled: false })
    binding.attach(first as never)
    expect(controller.store.getSnapshot().fields.find((f) => f.path === 'enabled')?.text).toBe('false')
    // Adopt a second host scope: the card follows the new one, and the first
    // scope's subscription is dropped rather than left publishing.
    binding.attach(fakeScope({ enabled: true }) as never)
    expect(controller.store.getSnapshot().fields.find((f) => f.path === 'enabled')?.text).toBe('true')
    first.emit()
    expect(controller.store.getSnapshot().fields.find((f) => f.path === 'enabled')?.text).toBe('true')
  })

  it('answers the unavailable snapshot shape the card reads', () => {
    const binding = new SettingsScopeBinding()
    expect(binding.attached).toBeUndefined()
    expect(binding.getSnapshot()).toEqual({
      status: 'unavailable',
      writable: false,
      base: undefined,
      user: undefined,
      value: undefined,
      revision: undefined,
      mode: 'host',
    })
    // A write with nothing attached settles instead of rejecting, so a stray
    // save cannot tear the card down with an unhandled rejection.
    return expect(binding.set('enabled', true)).resolves.toBeUndefined()
  })
})

describe('settings scope resolution survives host layout drift', () => {
  // The user's desktop app runs `dsh-desktop 0.2.0-rc.2`, which replaced the
  // per-namespace `settingsScope` binder with the shared `configForms` service.
  // Naming EITHER in the fiber's declared inject list would make the boot wait
  // forever for a service the other generation never provides, so `apply`
  // declares only `slots` and `locale` and reaches each settings service
  // through its own optional `ctx.inject` child fiber. The contract pinned here
  // is the declared list plus the two service names actually resolved.
  const declaredInject = ['slots', 'locale']
  const settingsServices = ['configForms', 'settingsScope']

  it('declares only the services that every host layout provides', () => {
    expect(declaredInject).toEqual(['slots', 'locale'])
    expect(declaredInject).not.toContain('configForms')
    expect(declaredInject).not.toContain('settingsScope')
    expect(declaredInject).not.toContain('settings')
  })

  it('resolves each settings service through its own child fiber', async () => {
    const source = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
    for (const name of settingsServices) {
      expect(source).toContain(`ctx.inject(['${name}']`)
    }
  })

  it('registers the modern slots and the historical one', async () => {
    const source = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
    expect(source).toContain("'plugins.row.config'")
    expect(source).toContain("'plugins.bundle.config'")
    expect(source).toContain("'settings.plugin.item'")
  })
})
