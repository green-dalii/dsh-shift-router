/**
 * dsh-shift-router — browser half
 *
 * Registers one settings card into the Settings → Plugins → Plugin
 * configuration section (the `settings.plugin.item` slot declared by
 * `dsh-client-ui-settings-plugins`). The card binds the `shift-router`
 * settings namespace — the same namespace the host plugin registers through
 * `dsh-settings` — so a value edited here is the value `/router config`
 * reports and the running router uses.
 *
 * The slot is **keyed**, and its cell key IS the settings namespace: the tab
 * enumerates the namespaces the Host serves and dispatches one key per
 * namespace, so `key: NS` is what pairs this card with the `shift-router`
 * namespace (an `id` is a list-slot option and `SlotCore` rejects it outright).
 *
 * The slot contract is therefore taken from the package that DECLARES it —
 * `@deepseek-ai/dsh-client-ui-settings-plugins/client`, type-only, so nothing
 * enters the bundle — instead of being spelled here. A local copy does not
 * merely age badly: the compiler then enforces a contract that does not exist
 * (this file once declared the slot as a `list` and so blessed an `id`-keyed
 * registration that never rendered — see ALIGNMENT.md §R6).
 */

import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context } from '@deepseek-ai/cordis'
import { ShiftRouterCardController } from './controller.js'
import type { LlmCatalogApi } from './model-catalog.js'
import { ShiftRouterCard } from './ShiftRouterCard.js'
import { en, zh, type ShiftRouterCardKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  // `SlotMap['settings.plugin.item']` is NOT declared here: it belongs to the
  // declarer (imported above), and re-declaring it is how the card silently
  // stopped rendering. Only the dictionary namespace, which this package owns,
  // is augmented locally.
  interface LocaleNamespaceMap {
    /** Dictionary namespace owned by the shift-router card. */
    'shift-router': ShiftRouterCardKey
  }
}

/**
 * Settings namespace owned by the host plugin (`src/index.ts`,
 * `ROUTER_SETTINGS_NAMESPACE`) — and the card's cell key in the keyed slot.
 * The two halves cannot import one another across the browser boundary, so the
 * pairing is pinned by `tests/client-card-slot.test.ts` instead.
 */
const NS = 'shift-router'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * Mount the shift-router settings card.
 * @param ctx - the browser plugin context (cordis `Context`, augmented by the
 *   client packages: `ctx.slots`, `ctx.locale`, `ctx.settingsScope`).
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'shift-router: card dictionaries')
  // `connection` (dsh-client-connection) provides the api the model dropdowns
  // read the deployment's configured models from; it may be absent in exotic
  // shells, in which case the card falls back to free-text model rows.
  const connection = ctx.get('connection') as { api?: unknown } | undefined
  const controller = new ShiftRouterCardController(
    ctx.settingsScope.bind({ namespace: NS }),
    connection?.api as LlmCatalogApi | undefined,
  )
  // Keyed slot: `key` (the settings namespace) is the cell key the tab
  // dispatches on. A keyed cell has no `id`/`order` — registration order is the
  // ledger's, and the tab renders in the served-namespace order.
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: NS,
    locale: NS,
    inject: () => controller.inject(),
  }, ShiftRouterCard))
}
