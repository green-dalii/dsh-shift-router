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
 * Slot/locale contracts are declared here (see the module augmentation
 * below): the section host declares `settings.plugin.item` at runtime, and
 * this package's bundle must not value-import from the host package, so the
 * contract is spelled locally and checked against the host only by behavior.
 */

import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { Context } from '@deepseek-ai/cordis'
import { ShiftRouterCardController } from './controller.js'
import type { LlmCatalogApi } from './model-catalog.js'
import { ShiftRouterCard } from './ShiftRouterCard.js'
import { en, zh, type ShiftRouterCardKey } from './locales.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One plugin's card inside the plugin configuration section (see the host package's slot-contract). */
    'settings.plugin.item': {
      kind: 'list'
      scope: 'root'
      owner: { children?: never }
    }
  }
  interface LocaleNamespaceMap {
    /** Dictionary namespace owned by the shift-router card. */
    'shift-router': ShiftRouterCardKey
  }
}

/** Settings namespace owned by the host plugin (`src/index.ts`). */
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
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    id: 'shift-router',
    order: 30,
    locale: NS,
    inject: () => controller.inject(),
  }, ShiftRouterCard))
}
