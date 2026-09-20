/**
 * dsh-shift-router — client-side model catalog
 *
 * The card's provider/model controls are fed by the **Host generation's model
 * catalog**: `ctx.remote.session.modelCatalog()`, the same remote the `/model`
 * selector reads (`dsh-api-session-controller`'s `buildModelCatalog()` over the
 * live LLM registry). Nothing here invents, caches or hardcodes a list — a wrong
 * source fails silently, because the only symptom is that a dropdown becomes a
 * text box (ALIGNMENT.md §R7).
 *
 * The module is pure apart from the one awaited call: the mapping from the wire
 * shape is testable against real response envelopes (provider groups,
 * per-provider failures, the failure envelope, a thrown transport error).
 */

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelCatalog as HostModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'

/** One selectable provider or model. */
export interface CatalogEntry {
  id: string
  /** Display name; falls back to the id. */
  name: string
}

/** One provider the Host could not enumerate, with the reason it reported. */
export interface CatalogFailure {
  id: string
  name: string
  message: string
}

/** The card's catalog snapshot. */
export interface ModelCatalog {
  status: 'loading' | 'ready' | 'failed'
  /** Why the whole read failed (status `failed` with no per-provider cause). */
  error?: string
  /** Providers that currently serve a request, in catalog order. */
  providers: CatalogEntry[]
  /** Models each provider advertises, in provider order. */
  modelsByProvider: Record<string, CatalogEntry[]>
  /** Providers whose lookup failed; a failure is shown, never hidden. */
  failures: CatalogFailure[]
  /** The deployment default selection, when the Host reports one. */
  default?: { provider: string; model: string }
}

/**
 * `catalog.error` sentinel: the client assembly provided no catalog remote at
 * all, which the card states in its own words (a Host error would come with a
 * code and a message instead).
 */
export const CATALOG_UNAVAILABLE = 'model-catalog-unavailable'

export const EMPTY_CATALOG: ModelCatalog = {
  status: 'loading',
  providers: [],
  modelsByProvider: {},
  failures: [],
}

/** The envelope every generated remote answers with. */
type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/**
 * The remote face the card consumes — a subset of `ctx.remote`, structurally
 * typed so the bundle value-imports nothing and a test needs no client runtime.
 */
export interface ModelCatalogRemote {
  session: {
    modelCatalog(): Promise<RemoteResult<HostModelCatalog>>
  }
}

/**
 * Map the Host catalog onto the card's flat shape.
 * @param host - the catalog as the Host reports it.
 * @returns the card's snapshot, with provider failures preserved.
 */
export function mapHostCatalog(host: HostModelCatalog): ModelCatalog {
  const providers: CatalogEntry[] = []
  const modelsByProvider: Record<string, CatalogEntry[]> = {}
  for (const group of host.groups) {
    providers.push({ id: group.id, name: group.name || group.id })
    modelsByProvider[group.id] = group.models.map((model) => ({
      id: model.id,
      name: model.name || model.id,
    }))
  }
  const failures = host.failures.map((failure) => ({
    id: failure.id,
    name: failure.name || failure.id,
    message: failure.message,
  }))
  const fallback = host.default
  return {
    status: 'ready',
    providers,
    modelsByProvider,
    failures,
    ...(fallback === undefined
      ? {}
      : { default: { provider: fallback.provider, model: fallback.model } }),
  }
}

/**
 * Read the deployment's model catalog.
 *
 * Any failure — the remote's own `ok:false` envelope or a thrown transport error
 * — degrades to `failed` with the reason attached, so the card can say why its
 * dropdowns are unavailable instead of rendering empty controls.
 * @param remote - the client remote carrying the `session` namespace.
 * @returns the catalog snapshot.
 */
export async function loadModelCatalog(remote: ModelCatalogRemote): Promise<ModelCatalog> {
  try {
    const response = await remote.session.modelCatalog()
    if (!response.ok) {
      return {
        ...EMPTY_CATALOG,
        status: 'failed',
        error: `${response.error.code}: ${response.error.message}`,
      }
    }
    return mapHostCatalog(response.value)
  } catch (error) {
    return {
      ...EMPTY_CATALOG,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** The forwarded events after which the Host's catalog may have changed. */
export const CATALOG_REFRESH_EVENTS = [
  'llm/adapters-updated',
  'settings/document-updated',
  'credentials/reference-updated',
] as const
