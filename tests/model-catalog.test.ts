/**
 * dsh-shift-router — client model catalog loader tests
 *
 * `loadModelCatalog` maps the deployment's `llm.models` remote response into
 * the dropdown source the card consumes: one entry per provider that
 * currently advertises models (the configured set — dormant routes from the
 * declarative directory are intentionally not listed). It is pure (the api is
 * injected structurally), so it runs in this suite.
 */

import { describe, expect, it } from 'vitest'
import { loadModelCatalog, type LlmCatalogApi } from '../src/client/model-catalog.js'

function fakeApi(result: {
  groups?: { id: string; name: string; models: { id: string; name: string }[] }[]
  reject?: boolean
}): LlmCatalogApi {
  const ok = <T,>(value: T) => ({ ok: true as const, value })
  return {
    llm: {
      models: async () => {
        if (result.reject) throw new Error('boom')
        return { result: ok({ groups: result.groups ?? [] }) }
      },
    },
  }
}

describe('loadModelCatalog', () => {
  it('maps the model groups into providers and per-provider model lists', async () => {
    const api = fakeApi({
      groups: [
        {
          id: 'opencode-go',
          name: 'OpenCode Go',
          models: [
            { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
            { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
          ],
        },
        { id: 'other', name: 'Other', models: [{ id: 'm1', name: '' }] },
      ],
    })
    const catalog = await loadModelCatalog(api)
    expect(catalog.status).toBe('ready')
    expect(catalog.providers).toEqual([
      { id: 'opencode-go', name: 'OpenCode Go' },
      { id: 'other', name: 'Other' },
    ])
    expect(catalog.modelsByProvider['opencode-go']).toEqual([
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
    ])
    // Empty model name falls back to the id.
    expect(catalog.modelsByProvider['other']).toEqual([{ id: 'm1', name: 'm1' }])
  })

  it('lists only providers with an advertised model list (no dormant routes)', async () => {
    // The declarative directory has many dormant routes; llm.models only emits
    // groups for providers that currently advertise models.
    const api = fakeApi({
      groups: [
        { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'Flash' }] },
      ],
    })
    const catalog = await loadModelCatalog(api)
    expect(catalog.providers).toEqual([{ id: 'deepseek-official', name: 'DeepSeek' }])
    expect(catalog.providers.some((p) => p.id === 'anthropic')).toBe(false)
    expect(catalog.providers.some((p) => p.id === 'openai')).toBe(false)
  })

  it('degrades to failed on transport failure', async () => {
    const catalog = await loadModelCatalog(fakeApi({ reject: true }))
    expect(catalog.status).toBe('failed')
    expect(catalog.providers).toEqual([])
    expect(catalog.modelsByProvider).toEqual({})
  })

  it('degrades to failed when the method returns an error branch', async () => {
    const api: LlmCatalogApi = {
      llm: {
        models: async () => ({ result: { ok: false as const, error: { code: 'internal', message: 'nope' } } }),
      },
    }
    const catalog = await loadModelCatalog(api)
    expect(catalog.status).toBe('failed')
  })
})
