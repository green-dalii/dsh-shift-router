/**
 * dsh-shift-router — reading the volatile `Config` in tests
 *
 * `Config` marks each top-level field `.volatile()` (see `src/config.ts`):
 * the Host serves a settings namespace only when the schema projects a volatile
 * form, and per-section volatile resolves to a plain object whose fields are
 * `Volatile` references. Every suite that inspects a resolved config therefore
 * reads through here, instead of each restating the unwrap.
 *
 * Structural, like the plugin's own `asConfigRef`, because the package under
 * test does not depend on `@deepseek-ai/cosmokit` either.
 */

/**
 * Read the config a schema result carries, unwrapping every volatile reference.
 *
 * - Top-level `value` may itself be a reference (a `Volatile` schema's output);
 *   the top check unwraps that one layer.
 * - Each field of a resolved plain object may itself be a reference (per-section
 *   volatile); the recursive walk unwraps those.
 *
 * Leaving an unwrapped function in the returned config would make the next
 * `structuredClone` in `refreshConfig()` throw `DataCloneError`, so the walk
 * is the difference between a working test and a misleading one.
 * @param value - a resolved config, or the `Volatile` reference that wraps one.
 * @returns a detached plain config; undefined when nothing was provided.
 */
export function readConfig<T>(value: unknown): T {
  const walk = (node: unknown): unknown => {
    if (typeof node !== 'object' || node === null) return node
    const get = (node as { get?: unknown }).get
    if (typeof get === 'function') return walk((get as () => unknown).call(node))
    if (Array.isArray(node)) return node.map(walk)
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(node)) out[key] = walk(child)
    return out
  }
  return walk(value) as T
}
