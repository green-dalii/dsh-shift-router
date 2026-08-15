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

import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { ShiftRouterCardController } from './controller.js'
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
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'shift-router: card dictionaries')
  const controller = new ShiftRouterCardController(ctx.settingsScope.bind({ namespace: NS }))
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    id: 'shift-router',
    order: 30,
    locale: NS,
    inject: () => controller.inject(),
  }, ShiftRouterCard))
}
