/**
 * dsh-shift-router — GUI card slot registration tests
 *
 * WHY THIS FILE EXISTS
 *
 * The card registers into `settings.plugin.item`, a slot whose contract belongs
 * to `dsh-client-ui-settings-plugins`: it is a **keyed** slot, and its cell key
 * is the settings namespace. `SlotCore.register` enforces the kind
 *
 *     keyed slot "settings.plugin.item" requires options.key
 *
 * and the tab's projection (`entry.options.key !== undefined &&
 * served.has(entry.options.key)`) selects cards by that same key. A list-shaped
 * registration (`id`) therefore both throws and can never render — which is how
 * the card once shipped invisible (ALIGNMENT.md §R6): every test passed because
 * none of them touched a registry with kind rules, and `tsc` passed because this
 * package had re-declared the slot locally as `kind: 'list'`.
 *
 * So the registry below is the harness's REAL `SlotCore`, and the load order
 * mirrors the deployment: the card plugin is loaded during boot, long before the
 * user opens Settings and the tab declares the slot.
 */

import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

import { ROUTER_SETTINGS_NAMESPACE } from '../src/index.js'
import * as card from '../src/client/index.js'
import { ShiftRouterCard } from '../src/client/ShiftRouterCard.js'

// In the browser the card's store comes from the platform seed
// (`@deepseek-ai/dsh-client-store`); in Node that package resolves to an engine
// whose `zustand`/`immer` peers the harness bundles rather than declares. The
// suite supplies the same contract locally, so the registration path under test
// is the real one.
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
      update: (mutate: (draft: T) => void) => {
        const draft = structuredClone(state)
        mutate(draft)
        state = draft
        notify()
      },
    }
  },
}))

/** The slot the card contributes to (declared by `dsh-client-ui-settings-plugins`). */
const SLOT = 'settings.plugin.item'

/** The settings document the bound scope would serve; the card only reads it at build time. */
const SNAPSHOT = {
  status: 'ready',
  writable: true,
  revision: 0,
  base: {},
  value: {},
  user: {},
}

type LooseRegister = (options: Record<string, unknown>, component: () => null) => () => void

/**
 * Mount the Settings → Plugins chain as the harness does, one declaration level
 * at a time: `root` → `settings.section` → `settings.plugins.tab`, the tab's own
 * registration declaring the keyed card slot. `tab: false` stops one level short
 * — the section exists, the user has not opened the tab, so the slot is not
 * declared yet.
 * @param core - the real slot registry.
 * @param options - whether the tab is mounted.
 */
function mountHostSettings(core: SlotCore, options: { tab: boolean } = { tab: true }): void {
  const register = core.register.bind(core) as unknown as LooseRegister
  register(
    { name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } },
    () => null,
  )
  register(
    {
      name: 'settings.section',
      id: 'plugins',
      children: { 'settings.plugins.tab': { kind: 'list', scope: 'root' } },
    },
    () => null,
  )
  if (options.tab) declareCardSlot(core)
}

/** Declare the keyed card slot by re-registering the tab that owns it. */
function declareCardSlot(core: SlotCore): () => void {
  return (core.register.bind(core) as unknown as LooseRegister)(
    {
      name: 'settings.plugins.tab',
      id: 'configurable',
      children: { [SLOT]: { kind: 'keyed', scope: 'root' } },
    },
    () => null,
  )
}

/**
 * A context with the services the browser half requires, whose `slots` is the
 * real registry (a stub has no kind rules to violate) and whose `slots.inject`
 * mirrors the runtime service: run the callback now when the slot is already
 * declared, otherwise on the declaration.
 * @param core - the real slot registry.
 * @returns the fake context and the effects it installed.
 */
function cardContext(core: SlotCore): { ctx: Context; effects: string[] } {
  const effects: string[] = []
  const boundScope = {
    subscribe: () => () => {},
    getSnapshot: () => SNAPSHOT,
  }
  const slots = {
    register: (options: Record<string, unknown>, component: unknown) =>
      core.register(options as never, component as never),
    inject: (key: string, callback: () => () => void) => {
      let active: (() => void) | undefined
      let epoch = -1
      const reconcile = () => {
        const spec = core.specDynamic(key)
        const current = core.declarationEpoch(key)
        if (active !== undefined && epoch === current) return
        const previous = active
        active = undefined
        previous?.()
        if (spec === undefined) return
        epoch = current
        active = callback()
      }
      const unsubscribe = core.subscribeDeclaration(key, reconcile)
      reconcile()
      return () => {
        unsubscribe()
        active?.()
      }
    },
  }
  const ctx = {
    effect: (callback: () => () => void, label: string) => {
      effects.push(label)
      return callback()
    },
    get: () => undefined,
    locale: { register: () => () => {} },
    settingsScope: { bind: () => boundScope },
    slots,
  }
  return { ctx: ctx as unknown as Context, effects }
}

/** The tab's own selection rule, copied from `ConfigurablePluginsTabController`. */
function selectedCards(core: SlotCore, served: readonly string[]) {
  const live = new Set(served)
  return core
    .entries(SLOT)
    .filter((entry) => entry.options.key !== undefined && live.has(entry.options.key))
}

describe('the card registers into the keyed settings slot', () => {
  it('loads before the Settings panel declares the slot (the real order)', () => {
    const core = new SlotCore()
    // The card plugin is loaded at boot: the tab exists, but the user has not
    // opened Settings, so nothing has declared the card slot yet.
    mountHostSettings(core, { tab: false })
    card.apply(cardContext(core).ctx)
    expect(core.entries(SLOT)).toHaveLength(0)
    expect(core.specDynamic(SLOT)).toBeUndefined()

    // Opening Setup → Plugins mounts the tab, which declares the card slot.
    declareCardSlot(core)

    const [entry] = core.entriesOfSlot(SLOT)
    expect(entry?.options.key).toBe('shift-router')
    expect(entry?.component).toBe(ShiftRouterCard)
  })

  it('registers immediately when the slot is already declared', () => {
    const core = new SlotCore()
    mountHostSettings(core)
    card.apply(cardContext(core).ctx)

    expect(core.entries(SLOT)).toHaveLength(1)
    expect(core.entries(SLOT)[0]?.options.key).toBe('shift-router')
    expect(core.specDynamic(SLOT)?.kind).toBe('keyed')
  })

  it('keys the cell on the host settings namespace and is selected by it', () => {
    const core = new SlotCore()
    mountHostSettings(core)
    card.apply(cardContext(core).ctx)

    expect(ROUTER_SETTINGS_NAMESPACE).toBe('shift-router')
    // The tab dispatches one key per namespace the Host serves: `shift-router`
    // must select exactly this card, and an unrelated served namespace must not.
    expect(selectedCards(core, [ROUTER_SETTINGS_NAMESPACE])).toHaveLength(1)
    expect(selectedCards(core, ['bash', 'agent-loop'])).toHaveLength(0)
  })

  it('exposes the card face and its dictionary namespace', () => {
    const core = new SlotCore()
    mountHostSettings(core)
    const { ctx, effects } = cardContext(core)
    card.apply(ctx)

    const entry = core.entries(SLOT)[0]
    expect(entry?.locale).toBe('shift-router')
    const face = entry?.inject?.() as { edit?: unknown } | undefined
    expect(typeof face?.edit).toBe('function')
    expect(effects).toEqual(['shift-router: card dictionaries'])
  })
})
