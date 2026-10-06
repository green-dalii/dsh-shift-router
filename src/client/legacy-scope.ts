/**
 * dsh-shift-router — the pre-0.2.0 settings service this card also accepts
 *
 * `@deepseek-ai/dsh-client-ui-settings` served a namespace through a
 * per-namespace scope handle up to and including 0.1.5-rc.x:
 *
 *     // dsh-client-ui-settings@0.1.5-rc.2 lib/types/client/index.d.ts:23
 *     export type { SettingsScope, SettingsScopeSnapshot, SettingsScopeSpec }
 *       from './settings-contract.ts';
 *     // dsh-client-ui-settings@0.1.5-rc.2 lib/types/client/settings-scope.d.ts:139
 *     bind<T>(spec: SettingsScopeSpec<T>): SettingsScope<T>;
 *
 * 0.2.0-rc.2 deleted that export and that service together, replacing both with
 * `ctx.configForms` (`ConfigForms.get` / `ConfigForm`), whose snapshot is
 * field-for-field the same shape. The desktop shell runs 0.2.0-rc.2, so the
 * new service is the one that matters; this file keeps an older shell working
 * without importing the old package, which cannot coexist in one tree with the
 * new one (npm refuses the peer graph, and two copies of
 * `@deepseek-ai/dsh-client-ui-slots` would split the `SlotMap` augmentation).
 *
 * So the face below is declared from the quoted 0.1.5-rc.2 contract. It is
 * deliberately minimal and structural — read, observe, and the two writes the
 * card performs — and `SettingsScopeBinding` normalizes it onto the same
 * `CardScope` the 0.2.0-rc.2 service satisfies.
 */

import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

/** One namespace's handle over the settings document, as 0.1.5-rc.x exposed it. */
export interface SettingsScope<T> {
  /** @returns the current sync snapshot (stable reference until the next change). */
  getSnapshot(): ConfigFormSnapshot<T>
  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each snapshot change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void
  /**
   * Queue one field write.
   * @param field - scalar field inside the namespace section.
   * @param value - JSON-shaped value selected by the user.
   * @returns settlement after the write and any latest-write recovery read.
   */
  set(field: string, value: unknown): Promise<void>
  /**
   * Queue one field clear, so the field re-inherits the composition layer.
   * @param field - scalar field inside the namespace section.
   * @returns settlement after the clear and any latest-write recovery read.
   */
  unset(field: string): Promise<void>
}

/** The namespace binder the 0.1.5-rc.x settings service exposed. */
export interface SettingsScopeService {
  /**
   * Bind one settings namespace.
   * @param spec - namespace identity and optional narrowing decoder.
   * @returns the namespace's scope handle.
   */
  bind<T>(spec: { namespace: string; decode?: (section: unknown) => T | undefined }): SettingsScope<T>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * The settings-namespace scope service of a shell up to 0.1.5-rc.x. Absent
     * on 0.2.0-rc.2 and later, where the name resolves to nothing and any
     * `ctx.inject(['settingsScope'], …)` simply never runs.
     */
    settingsScope: SettingsScopeService
  }
}
