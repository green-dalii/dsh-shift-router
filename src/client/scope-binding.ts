/**
 * dsh-shift-router — the browser half's settings-scope seam
 *
 * A host serves one settings namespace through exactly one of two client
 * services, and the two do not overlap across the shells this plugin supports:
 *
 *   - `ctx.settingsScope.bind({ namespace })` — every shell up to and
 *     including 0.1.5-rc.x, from `@deepseek-ai/dsh-client-ui-settings`.
 *   - `ctx.configForms.get(namespace)` — 0.2.0-rc.2 replaced the per-namespace
 *     binder with one shared-form service. `settingsScope` does NOT exist in
 *     that release: a literal grep over its shipped client packages returns
 *     zero hits, and the desktop shell is on 0.2.0-rc.2.
 *
 * The card needs one scope, not two. So the controller holds a
 * {@link SettingsScopeBinding} from construction: {@link attach} swaps the live
 * scope in, moves the subscription to it, and republishes. Until a host
 * provides one the binding answers `status: 'unavailable'`, which is the state
 * the card renders as a "this host serves no settings" notice rather than an
 * indefinite spinner.
 */

import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { CardScope } from './controller.js'

/**
 * The snapshot a host that serves no settings namespace reports.
 *
 * `unavailable` (not `loading`): `loading` is reserved for the window between a
 * host attaching and its first accepted section. Keeping the two apart is what
 * lets the card state a reason instead of spinning forever.
 */
export const UNAVAILABLE_SNAPSHOT: ConfigFormSnapshot<unknown> = {
  status: 'unavailable',
  writable: false,
  base: undefined,
  user: undefined,
  value: undefined,
  revision: undefined,
  mode: 'host',
}

/**
 * One stable settings-scope handle whose backing scope can be attached later.
 *
 * Why not resolve the service before constructing the controller: the two
 * services arrive on different fibers and in either order relative to this
 * plugin, and a host may provide neither. A handle that starts unattached keeps
 * the boot free of service-name dependencies while still giving the card one
 * object to hold.
 */
export class SettingsScopeBinding implements CardScope {
  private scope: CardScope | undefined
  private detach: (() => void) | undefined
  private readonly listeners = new Set<() => void>()

  /**
   * Adopt a host's scope, replacing any earlier one.
   * @param scope - the scope the host served for this namespace.
   */
  attach(scope: CardScope): void {
    this.detach?.()
    this.scope = scope
    this.detach = scope.subscribe(() => this.publish())
    this.publish()
  }

  /** @returns the attached scope, or undefined while no host has provided one. */
  get attached(): CardScope | undefined {
    return this.scope
  }

  getSnapshot(): ConfigFormSnapshot<unknown> {
    return this.scope?.getSnapshot() ?? UNAVAILABLE_SNAPSHOT
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async set(field: string, value: unknown): Promise<unknown> {
    return await this.scope?.set(field, value)
  }

  async unset(field: string): Promise<unknown> {
    return await this.scope?.unset(field)
  }

  /** Tell every observer the snapshot may have moved. */
  private publish(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
