/**
 * dsh-shift-router — browser half
 *
 * Registers one settings card for the `shift-router` settings namespace. Which
 * surface the card lands on depends on the shell generation, because the
 * extension point moved between them:
 *
 *   - **0.2.0-rc.2 and later** — the sidebar Plugins page. The card occupies
 *     `plugins.row.config` (keyed `<bundle>#<row id>`, so the row gains a
 *     configure control) and `plugins.bundle.config` (keyed by the bundle
 *     package name, so the form also sits on the bundle's own page). Both are
 *     declared by `@deepseek-ai/dsh-client-ui-plugin-manager`, and the settings
 *     transport is `ctx.configForms`.
 *   - **up to 0.1.5-rc.x** — the Settings → Plugins → Plugin configuration
 *     tab. The card occupies the keyed `settings.plugin.item` cell and the
 *     transport is `ctx.settingsScope.bind({ namespace })`.
 *
 * Registering into a slot the running shell does not declare is silent when the
 * registration goes through `ctx.slots.inject`: the callback runs only once the
 * slot is declared, so on that shell it never runs and never errors. (A DIRECT
 * `slots.register` into an undeclared slot throws instead.) That silence is why
 * the 0.2.0-rc.2 move produced no diagnostic in the GUI — the card was
 * registering into a slot nobody declared (ALIGNMENT §R15).
 *
 * The slot contracts are therefore taken from the packages that DECLARE them —
 * `dsh-client-ui-plugin-manager/client` for `plugins.row.config`, and
 * `legacy-slot.ts` for the historical cell — instead of being spelled here. A
 * local copy does not merely age badly: the compiler then enforces a contract
 * that does not exist, which is how the card once shipped invisible with a
 * green suite (ALIGNMENT.md §R6).
 */

import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from './legacy-slot.js'
import type { Context } from '@deepseek-ai/cordis'
import { ShiftRouterCardController } from './controller.js'
import { SettingsScopeBinding } from './scope-binding.js'
import { CATALOG_REFRESH_EVENTS, type ModelCatalogRemote } from './model-catalog.js'
import { ShiftRouterCard } from './ShiftRouterCard.js'
import { en, zh, type ShiftRouterCardKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  // Neither slot is re-declared here: `plugins.row.config` and
  // `plugins.bundle.config` belong to `dsh-client-ui-plugin-manager` and
  // `settings.plugin.item` to `legacy-slot.ts`, and both are imported above.
  // Only the dictionary namespace, which this package owns, is augmented
  // locally.
  interface LocaleNamespaceMap {
    /** Dictionary namespace owned by the shift-router card. */
    'shift-router': ShiftRouterCardKey
  }
}

/**
 * Settings namespace owned by the host plugin (`src/index.ts`,
 * `ROUTER_SETTINGS_NAMESPACE`) — and the namespace every client service here is
 * asked for. The two halves cannot import one another across the browser
 * boundary, so the pairing is pinned by `tests/client-card-slot.test.ts`
 * instead.
 */
const NS = 'shift-router'

/** The bundle package name, as the profile's dependency and the loader row see it. */
const BUNDLE = 'dsh-shift-router'

/** The loader row id this bundle's patch declares (`cordis.patch.yml`). */
const ROW = 'shift-router'

/**
 * The `plugins.row.config` key: `<package name>#<row id>`. It is also what the
 * Plugins page checks before it draws the row's configure control, so this
 * literal IS the affordance's existence proof.
 */
export const ROW_CONFIG_KEY = `${BUNDLE}#${ROW}`

/** Required services (cordis fiber inject): present in every shell. */
export const inject = ['slots', 'locale']

/**
 * Mount the shift-router configuration card on whichever surface this shell
 * declares.
 * @param ctx - the browser plugin context (cordis `Context`, augmented by the
 *   client packages: `ctx.slots`, `ctx.locale`, `ctx.configForms`).
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'shift-router: card dictionaries')
  // One controller for every surface: a shell that declares two of them edits
  // one form, with one set of drafts. The binding is what lets a single
  // controller be constructed before any settings service has arrived.
  const binding = new SettingsScopeBinding()
  const controller = new ShiftRouterCardController(binding)
  // Until the composition provides the catalog remote, the card says so rather
  // than showing a loading state that will never resolve — the failure mode that
  // quietly turned every model control into a text box (ALIGNMENT §R7).
  controller.attachCatalog(undefined)
  // Model lists come from the Host generation catalog — the same remote the
  // `/model` selector reads (SPEC §12.2). It is read reactively: a composition
  // that provides `remote` after this plugin loads still gets dropdowns, and one
  // that never does keeps a card that says why instead of failing to mount.
  ctx.inject(['remote', 'remote.session'], (rctx) => {
    const remote: ModelCatalogRemote = rctx.remote
    controller.attachCatalog(remote)
    for (const event of CATALOG_REFRESH_EVENTS) {
      rctx.effect(
        () => rctx.remote.$on(event, () => void controller.refreshCatalog()),
        `shift-router: reload models on ${event}`,
      )
    }
  })
  // A reconnect is a new Host generation: the previous catalog is not evidence
  // about this one.
  ctx.on('connection/reset', () => void controller.refreshCatalog())

  // ── 0.2.0-rc.2+ — the Plugins page ───────────────────────────────────
  // `whileServed` gates the registration on the Host actually serving this
  // namespace (its `describe()` lists the entry only while the plugin's fiber is
  // active and its `Config` projects a volatile form). So a deployment that
  // never composed the host row shows no configure control and no dead page,
  // which is the documented contract of the two slots.
  ctx.inject(['configForms'], (cctx) => {
    binding.attach(cctx.configForms.get(NS))
    ctx.effect(
      () => cctx.configForms.whileServed([NS], () => {
        const offRow = cctx.slots.inject('plugins.row.config', () => cctx.slots.register({
          name: 'plugins.row.config',
          key: ROW_CONFIG_KEY,
          locale: NS,
          inject: () => controller.inject(),
        }, ShiftRouterCard))
        const offBundle = cctx.slots.inject('plugins.bundle.config', () => cctx.slots.register({
          name: 'plugins.bundle.config',
          key: BUNDLE,
          locale: NS,
          inject: () => controller.inject(),
        }, ShiftRouterCard))
        return () => {
          offRow()
          offBundle()
        }
      }),
      'shift-router: Plugins page configuration',
    )
  })

  // ── up to 0.1.5-rc.x — Settings → Plugins → Plugin configuration ─────
  // An older shell provides `settingsScope` and never `configForms`, so exactly
  // one of the two registrations lands. The cell is KEYED and its key IS the
  // settings namespace: the tab enumerates the namespaces the Host serves and
  // dispatches one key per namespace, so `key: NS` is what pairs this card with
  // the `shift-router` namespace (an `id` is a list-slot option and `SlotCore`
  // rejects it outright).
  ctx.inject(['settingsScope'], (sctx) => {
    binding.attach(sctx.settingsScope.bind({ namespace: NS }))
    ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
      name: 'settings.plugin.item',
      key: NS,
      locale: NS,
      inject: () => controller.inject(),
    }, ShiftRouterCard))
  })
}
