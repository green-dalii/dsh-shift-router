/**
 * dsh-shift-router — GUI card slot registration tests
 *
 * WHY THIS FILE EXISTS
 *
 * The card has two owner contracts, one per shell generation, and BOTH are
 * keyed slots whose cell key decides whether the card can ever render:
 *
 *   - 0.2.0-rc.2+ — `plugins.row.config`, declared by
 *     `@deepseek-ai/dsh-client-ui-plugin-manager` (`lib/client.js:3737`) as a
 *     child of the `main` Plugins panel, keyed `<package name>#<row id>`. The
 *     same ledger decides whether the row gets its configure control at all
 *     (`configured: { has: (row) => ledger.rows.has(rowConfigKey(pkg.name, row.rowId)) }`),
 *     so a wrong key is invisible rather than broken.
 *   - up to 0.1.5-rc.x — `settings.plugin.item`, declared by
 *     `@deepseek-ai/dsh-client-ui-settings-plugins` inside its own
 *     `configurable` tab, keyed by the settings namespace.
 *
 * `SlotCore.register` enforces the kind ("keyed slot … requires options.key").
 * A list-shaped registration (`id`) therefore both throws and can never render
 * — which is how the card once shipped invisible (ALIGNMENT.md §R6): every test
 * passed because none of them touched a registry with kind rules, and `tsc`
 * passed because this package had re-declared the slot locally as `kind: 'list'`.
 *
 * The mirror-image failure is the one this file now also pins: registering into
 * a slot the running shell does not declare is a SILENT no-op when the
 * registration goes through `ctx.slots.inject` (the callback simply never runs),
 * so 0.2.0-rc.2 dropping `settings.plugin.item` left the card registered
 * nowhere and the GUI said nothing (ALIGNMENT §R15).
 *
 * So the registry below is the harness's REAL `SlotCore`, and the load order
 * mirrors the deployment: the card plugin is loaded during boot, long before the
 * user opens either surface and something declares the slot.
 */

import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

import { ROUTER_SETTINGS_NAMESPACE } from '../src/index.js'
import * as card from '../src/client/index.js'
import { CATALOG_UNAVAILABLE, type ModelCatalog, type ModelCatalogRemote } from '../src/client/model-catalog.js'
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

/** The Plugins-page row slot (0.2.0-rc.2+), declared by the plugin manager. */
const ROW_SLOT = 'plugins.row.config'
/** The bundle slot (0.2.0-rc.2+), declared by the plugin manager. */
const BUNDLE_SLOT = 'plugins.bundle.config'
/** The historical settings cell (up to 0.1.5-rc.x), declared by the settings tab. */
const LEGACY_SLOT = 'settings.plugin.item'

/**
 * The key the Plugins page builds for one row
 * (`dsh-client-ui-plugin-manager/lib/client.js:27`), restated here so a drift in
 * the formula fails this suite instead of hiding the configure control.
 * @param bundle - the bundle's package name.
 * @param rowId - the row id the bundle's patch declares.
 * @returns the `plugins.row.config` key.
 */
function rowConfigKey(bundle: string, rowId: string): string {
  return `${bundle}#${rowId}`
}

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
 * Declare the layout's `main` panel slot, exactly as `dsh-client-ui-layout`
 * declares it from its `root` entry (`lib/client.js:602-610`). The Plugins page
 * is one `keyed` occupant of it.
 * @param core - the real slot registry.
 */
function declareLayoutRoot(core: SlotCore): void {
  (core.register.bind(core) as unknown as LooseRegister)(
    { name: 'root', children: { main: { kind: 'keyed', scope: 'root' } } },
    () => null,
  )
}

/**
 * Mount the plugin manager's `main` panel entry, which declares the three
 * configuration slots the page renders (`lib/client.js:3719-3740`). Until it
 * mounts, `plugins.row.config` is undeclared.
 * @param core - the real slot registry.
 */
function mountPluginsPage(core: SlotCore): void {
  (core.register.bind(core) as unknown as LooseRegister)(
    {
      name: 'main',
      key: 'plugins',
      children: {
        [ROW_SLOT]: { kind: 'keyed', scope: 'root' },
        [BUNDLE_SLOT]: { kind: 'keyed', scope: 'root' },
      },
    },
    () => null,
  )
}

/**
 * Mount the pre-0.2.0 Settings → Plugins chain, one declaration level at a time:
 * `root` → `settings.section` → `settings.plugins.tab`, the tab's own
 * registration declaring the keyed card slot. `tab: false` stops one level short
 * — the section exists, the user has not opened the tab, so the slot is not
 * declared yet.
 * @param core - the real slot registry.
 * @param options - whether the tab is mounted.
 */
function mountLegacySettings(core: SlotCore, options: { tab: boolean } = { tab: true }): void {
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
  if (options.tab) declareLegacyCardSlot(core)
}

/** Declare the keyed card slot by re-registering the tab that owns it. */
function declareLegacyCardSlot(core: SlotCore): () => void {
  return (core.register.bind(core) as unknown as LooseRegister)(
    {
      name: 'settings.plugins.tab',
      id: 'configurable',
      children: { [LEGACY_SLOT]: { kind: 'keyed', scope: 'root' } },
    },
    () => null,
  )
}

/** The model catalog the fake remote answers with. */
const CATALOG_REMOTE: ModelCatalogRemote = {
  session: {
    modelCatalog: async () => ({
      ok: true as const,
      value: {
        default: { provider: 'p', model: 'm' },
        routableProviders: ['p'],
        groups: [{ id: 'p', name: 'P', models: [{ id: 'm', name: 'M' }] }],
        failures: [],
      },
    }),
  },
}

/**
 * A context with the services the browser half requires, whose `slots` is the
 * real registry (a stub has no kind rules to violate) and whose `slots.inject`
 * mirrors the runtime service: run the callback now when the slot is already
 * declared, otherwise on the declaration.
 * @param core - the real slot registry.
 * @param options - which services the composition provides and whether it serves
 *   the settings namespace.
 * @returns the fake context, the effects it installed, and the subscribed events.
 */
function cardContext(core: SlotCore, options: {
  remote?: boolean
  configForms?: boolean
  settingsScope?: boolean
  serves?: boolean
} = {}): { ctx: Context, effects: string[], remoteEvents: string[], served: number } {
  const effects: string[] = []
  const remoteEvents: string[] = []
  const state = { served: 0 }
  const boundScope = {
    subscribe: () => () => {},
    getSnapshot: () => SNAPSHOT,
    set: async () => undefined,
    unset: async () => undefined,
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
  const effect = (callback: () => (() => void) | void, label: string) => {
    effects.push(label)
    return callback()
  }
  // The reactive dependency `apply` declares: the callback runs exactly when the
  // composition provides the services, as Cordis does.
  const remoteContext = {
    effect,
    remote: {
      session: CATALOG_REMOTE.session,
      $on: (event: string) => {
        remoteEvents.push(event)
        return () => {}
      },
    },
  }
  // `ConfigForms` as 0.2.0-rc.2 declares it: `get(namespace)` for the form and
  // `whileServed(namespaces, register)` to keep a page alive only while the Host
  // serves the namespace.
  const configForms = {
    get: () => boundScope,
    whileServed: (namespaces: readonly string[], register: (served: ReadonlySet<string>) => () => void) => {
      if (options.serves === false) return () => {}
      state.served += 1
      return register(new Set(namespaces))
    },
  }
  const ctx = {
    effect,
    get: () => undefined,
    inject: (deps: readonly string[], callback: (scope: unknown) => void) => {
      const providesRemote = deps.includes('remote') && options.remote !== false
      const providesForms = deps.includes('configForms') && options.configForms !== false
      const providesScope = deps.includes('settingsScope') && options.settingsScope !== false
      if (providesRemote) callback(remoteContext)
      if (providesForms) callback({ effect, slots, configForms })
      if (providesScope) callback({ effect, slots, settingsScope: { bind: () => boundScope } })
      return () => {}
    },
    on: () => () => {},
    locale: { register: () => () => {} },
    slots,
  }
  return { ctx: ctx as unknown as Context, effects, remoteEvents, served: state.served }
}

/** The card's published state, reached through the face a slot injects. */
function cardFace(core: SlotCore, slot: string): { getSnapshot(): { catalog: ModelCatalog } } {
  const face = core.entries(slot)[0]?.inject?.() as
    | { hooks: { shiftRouterCard: { getSnapshot(): { catalog: ModelCatalog } } } }
    | undefined
  if (face === undefined) throw new Error(`the card was not registered into ${slot}`)
  return face.hooks.shiftRouterCard
}

describe('the card registers into the Plugins page configuration slots', () => {
  it('loads before the Plugins page declares its slots (the real order)', () => {
    const core = new SlotCore()
    // The card plugin loads at boot: the layout declares `main`, but the user
    // has not opened the Plugins page, so nothing has declared the slots yet.
    declareLayoutRoot(core)
    card.apply(cardContext(core).ctx)
    expect(core.entries(ROW_SLOT)).toHaveLength(0)
    expect(core.specDynamic(ROW_SLOT)).toBeUndefined()

    // Opening the Plugins page mounts the manager's panel entry, which
    // declares its configuration slots.
    mountPluginsPage(core)

    const [row] = core.entriesOfSlot(ROW_SLOT)
    expect(row?.options.key).toBe('dsh-shift-router#shift-router')
    expect(row?.component).toBe(ShiftRouterCard)
  })

  it('keys the row cell exactly as the manager builds the key', () => {
    const core = new SlotCore()
    declareLayoutRoot(core)
    mountPluginsPage(core)
    card.apply(cardContext(core).ctx)

    // The bundle name is the npm package name and the row id is the one
    // `cordis.patch.yml` declares; the manager's own formula is restated above.
    expect(card.ROW_CONFIG_KEY).toBe(rowConfigKey('dsh-shift-router', 'shift-router'))
    expect(core.entries(ROW_SLOT)[0]?.options.key).toBe(card.ROW_CONFIG_KEY)
    expect(core.specDynamic(ROW_SLOT)?.kind).toBe('keyed')
  })

  it('keys the bundle cell on the package name', () => {
    const core = new SlotCore()
    declareLayoutRoot(core)
    mountPluginsPage(core)
    card.apply(cardContext(core).ctx)
    expect(core.entries(BUNDLE_SLOT)[0]?.options.key).toBe('dsh-shift-router')
    expect(core.entries(BUNDLE_SLOT)[0]?.component).toBe(ShiftRouterCard)
  })

  it('registers nothing while the Host does not serve the namespace', () => {
    // `whileServed` is the contract the official pages use: a deployment that
    // never composed the owning Host row shows no configure control and no dead
    // page. Both slots must honour it.
    const core = new SlotCore()
    declareLayoutRoot(core)
    mountPluginsPage(core)
    card.apply(cardContext(core, { serves: false }).ctx)
    expect(core.entries(ROW_SLOT)).toHaveLength(0)
    expect(core.entries(BUNDLE_SLOT)).toHaveLength(0)
  })

  it('enforces the keyed kind, so a list-shaped registration cannot hide', () => {
    const core = new SlotCore()
    declareLayoutRoot(core)
    mountPluginsPage(core)
    // The real registry is what makes the historical bug fail: an `id`-keyed
    // registration into a keyed slot throws instead of rendering nowhere.
    expect(() => core.register({ name: ROW_SLOT, id: 'shift-router' } as never, (() => null) as never))
      .toThrow(/keyed slot/)
    expect(() => core.register({ name: BUNDLE_SLOT, id: 'dsh-shift-router' } as never, (() => null) as never))
      .toThrow(/keyed slot/)
  })

  it('exposes the card face and its dictionary namespace', () => {
    const core = new SlotCore()
    declareLayoutRoot(core)
    mountPluginsPage(core)
    const { ctx, effects } = cardContext(core)
    card.apply(ctx)

    const entry = core.entries(ROW_SLOT)[0]
    expect(entry?.locale).toBe('shift-router')
    const face = entry?.inject?.() as { edit?: unknown } | undefined
    expect(typeof face?.edit).toBe('function')
    // Its dictionary registration is an effect, so unloading the plugin removes it.
    expect(effects).toContain('shift-router: card dictionaries')
  })

  it('loads the deployment catalog and subscribes to its refresh events', async () => {
    const core = new SlotCore()
    declareLayoutRoot(core)
    mountPluginsPage(core)
    const { ctx, remoteEvents } = cardContext(core)
    card.apply(ctx)

    // The card's own state is the observable: the dropdowns become real only
    // once the Host answered.
    const face = cardFace(core, ROW_SLOT)
    expect(face.getSnapshot().catalog.providers).toEqual([])
    await vi.waitFor(() => expect(face.getSnapshot().catalog.status).toBe('ready'))
    expect(face.getSnapshot().catalog.providers).toEqual([{ id: 'p', name: 'P' }])
    expect(remoteEvents).toEqual([
      'llm/adapters-updated',
      'settings/document-updated',
      'credentials/reference-updated',
    ])
  })

  it('still mounts, and says why, when the composition provides no catalog', () => {
    // The catalog is an enhancement: a shell without it must keep a usable card
    // (manual entry with a stated reason), never lose the card entirely.
    const core = new SlotCore()
    declareLayoutRoot(core)
    mountPluginsPage(core)
    const { ctx, remoteEvents } = cardContext(core, { remote: false })
    expect(() => card.apply(ctx)).not.toThrow()
    expect(core.entries(ROW_SLOT)).toHaveLength(1)
    expect(remoteEvents).toEqual([])
    expect(cardFace(core, ROW_SLOT).getSnapshot().catalog).toMatchObject({
      status: 'failed',
      error: CATALOG_UNAVAILABLE,
    })
  })
})

describe('the card also registers into the pre-0.2.0 settings cell', () => {
  it('loads before the Settings panel declares the slot (the real order)', () => {
    const core = new SlotCore()
    mountLegacySettings(core, { tab: false })
    card.apply(cardContext(core, { configForms: false }).ctx)
    expect(core.entries(LEGACY_SLOT)).toHaveLength(0)
    expect(core.specDynamic(LEGACY_SLOT)).toBeUndefined()

    declareLegacyCardSlot(core)

    const [entry] = core.entriesOfSlot(LEGACY_SLOT)
    expect(entry?.options.key).toBe('shift-router')
    expect(entry?.component).toBe(ShiftRouterCard)
  })

  it('keys the cell on the host settings namespace and is selected by it', () => {
    const core = new SlotCore()
    mountLegacySettings(core)
    card.apply(cardContext(core, { configForms: false }).ctx)

    expect(ROUTER_SETTINGS_NAMESPACE).toBe('shift-router')
    expect(core.specDynamic(LEGACY_SLOT)?.kind).toBe('keyed')
    expect(core.entries(LEGACY_SLOT)[0]?.options.key).toBe(ROUTER_SETTINGS_NAMESPACE)
  })

  it('does not reach the legacy surface on a shell that provides only configForms', () => {
    // The two generations are mutually exclusive: 0.2.0-rc.2 has no
    // `settingsScope` at all, so this registration never runs there.
    const core = new SlotCore()
    mountLegacySettings(core)
    card.apply(cardContext(core, { settingsScope: false }).ctx)
    expect(core.entries(LEGACY_SLOT)).toHaveLength(0)
  })
})
