/**
 * dsh-shift-router — the pre-0.2.0 settings cell this card also occupies
 *
 * `settings.plugin.item` was declared by `@deepseek-ai/dsh-client-ui-settings-plugins`
 * up to and including 0.1.5-rc.x, as a **keyed** root slot inside that
 * package's own `configurable` tab:
 *
 *     // dsh-client-ui-settings-plugins@0.1.5-rc.2 lib/client.js:1780
 *     ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
 *       name: 'settings.plugins.tab', id: 'configurable', ...
 *       children: { 'settings.plugin.item': { kind: 'keyed', scope: 'root' } },
 *     }, ConfigurablePluginsTab))
 *
 * 0.2.0-rc.2 removed that tab and that slot together, and moved feature
 * configuration onto the sidebar Plugins page (`plugins.bundle.config` and
 * `plugins.row.config`, declared by `dsh-client-ui-plugin-manager`). A literal
 * grep for `settings.plugin.item` over every `@deepseek-ai` package shipped in
 * the desktop 0.2.0-rc.2 app returns zero hits, and `tsc` confirms it: the
 * 0.2.0-rc.2 `SlotMap` does not carry the name.
 *
 * So this declaration exists for ONE reason: an older shell still composed with
 * this plugin must keep its configuration card. Both registrations go through
 * `ctx.slots.inject`, which runs its callback only once the slot is declared —
 * so on the generation that does not declare a slot the registration simply
 * never happens. (A DIRECT `slots.register` into an undeclared slot throws
 * instead; `inject` is what makes the pairing safe across generations, and it is
 * also why 0.2.0-rc.2's removal of the slot produced no diagnostic at all.)
 *
 * Declaring a slot locally is what ALIGNMENT §R6 warns about, and rightly: this
 * file once shipped `kind: 'list'` for a keyed slot and the card went invisible
 * while every test passed. The lesson is not "never declare" — it is "declare
 * what the OWNER declares, and pin it". Hence: the kind, scope, and `key`
 * option here are copied from the 0.1.5-rc.2 declarer quoted above, and
 * `tests/client-card-slot.test.ts` drives the real `SlotCore` with that
 * declaration chain so a wrong kind fails instead of passing.
 */

import type { PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-plugin-manager/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * One Host plugin's configuration card inside the pre-0.2.0 `configurable`
     * Plugins tab. Keyed by the settings namespace, exactly as the 0.1.5-rc.2
     * declarer had it.
     */
    'settings.plugin.item': {
      kind: 'keyed'
      scope: 'root'
      owner: Partial<PluginConfigViewProps>
    }
  }
}
