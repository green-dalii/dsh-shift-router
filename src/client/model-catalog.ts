/**
 * dsh-shift-router — client-side model catalog loader
 *
 * The Models section's provider/model dropdowns are populated from the
 * deployment's **currently configured models** — the same catalog the DSH
 * settings surface uses (`llm.models` host remote over the browser
 * connection), not a hardcoded list and not the declarative provider
 * directory (`llm.providers` lists every route an adapter *could* serve,
 * most of them dormant — showing them would be noise). This module is pure
 * and testable: it takes the subset of the connection's api surface the card
 * needs (structural typing — the bundle never value-imports the connection
 * package, the host provides the service at runtime) and returns a plain
 * catalog snapshot.
 */

/** The api surface the card uses (a structural subset of `connection.api`). */
export interface LlmCatalogApi {
  llm: {
    models(request: {}): Promise<{
      result: LlmResult<{
        groups: { id: string; name: string; models: { id: string; name: string }[] }[]
      }>
    }>
  }
}

/** The wire result slot: `{ok:true, value}` or `{ok:false, error}`. */
type LlmResult<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** One provider (or model) option in the catalog. */
export interface CatalogEntry {
  id: string
  /** Display name; falls back to the id. */
  name: string
}

/** The card's model catalog snapshot. */
export interface ModelCatalog {
  status: 'loading' | 'ready' | 'failed'
  /** Configured providers (those with an advertised model list), in catalog order. */
  providers: CatalogEntry[]
  /** Models each provider advertises, in provider order. */
  modelsByProvider: Record<string, CatalogEntry[]>
}

export const EMPTY_CATALOG: ModelCatalog = { status: 'loading', providers: [], modelsByProvider: {} }

/**
 * Load the deployment's configured model catalog.
 *
 * `llm.models` is the session-independent catalog: one group per provider
 * that currently advertises models — exactly "the models DSH is configured
 * with". Any transport or business failure degrades to `failed` — the card
 * falls back to free-text rows instead of blocking configuration.
 */
export async function loadModelCatalog(api: LlmCatalogApi): Promise<ModelCatalog> {
  try {
    const modelsRes = await api.llm.models({})
    if (!modelsRes.result.ok) throw new Error(modelsRes.result.error.message)
    const groups = modelsRes.result.value.groups ?? []
    const providers: CatalogEntry[] = []
    const byProvider: Record<string, CatalogEntry[]> = {}
    for (const group of groups) {
      providers.push({ id: group.id, name: group.name || group.id })
      byProvider[group.id] = group.models.map((model) => ({
        id: model.id,
        name: model.name || model.id,
      }))
    }
    return { status: 'ready', providers, modelsByProvider: byProvider }
  } catch {
    return { status: 'failed', providers: [], modelsByProvider: {} }
  }
}
