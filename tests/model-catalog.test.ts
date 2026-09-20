/**
 * dsh-shift-router — client model catalog tests
 *
 * The card's dropdowns are only as correct as this mapping, and the defect that
 * shipped was a WRONG SOURCE that failed silently (every control quietly became
 * a text box — ALIGNMENT §R7). So these tests drive the real response envelope
 * of `ctx.remote.session.modelCatalog()`: provider groups, per-provider
 * failures, the `ok:false` branch, and a thrown transport error. A test written
 * against a hand-made success object would have blessed the wrong remote just as
 * the typechecker did.
 */

import { describe, expect, it } from 'vitest'
import {
  CATALOG_REFRESH_EVENTS,
  loadModelCatalog,
  mapHostCatalog,
  type ModelCatalogRemote,
} from '../src/client/model-catalog.js'

type HostCatalog = Parameters<typeof mapHostCatalog>[0]

/** A catalog as the Host builds it, with only the fields under test overridden. */
function hostCatalog(overrides: Partial<HostCatalog> = {}): HostCatalog {
  return {
    default: { provider: 'opencode-go', model: 'deepseek-v4-flash' },
    routableProviders: ['opencode-go'],
    groups: [],
    failures: [],
    ...overrides,
  }
}

/** The remote, answering with the given envelope (or throwing). */
function fakeRemote(answer: { value?: HostCatalog; failure?: { code: string; message: string }; throws?: Error }): ModelCatalogRemote {
  return {
    session: {
      modelCatalog: async () => {
        if (answer.throws !== undefined) throw answer.throws
        if (answer.failure !== undefined) return { ok: false as const, error: answer.failure }
        return { ok: true as const, value: answer.value ?? hostCatalog() }
      },
    },
  }
}

describe('loadModelCatalog', () => {
  it('maps provider groups into providers and per-provider model lists', async () => {
    const remote = fakeRemote({
      value: hostCatalog({
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
      }),
    })
    const catalog = await loadModelCatalog(remote)
    expect(catalog.status).toBe('ready')
    expect(catalog.providers).toEqual([
      { id: 'opencode-go', name: 'OpenCode Go' },
      { id: 'other', name: 'Other' },
    ])
    expect(catalog.modelsByProvider['opencode-go']).toEqual([
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
    ])
    // An empty model name falls back to the id.
    expect(catalog.modelsByProvider['other']).toEqual([{ id: 'm1', name: 'm1' }])
  })

  it('lists only providers that currently advertise models', async () => {
    // The catalog emits one group per provider that is actually routable, so a
    // dormant adapter route is absent by construction — not filtered here.
    const remote = fakeRemote({
      value: hostCatalog({
        groups: [
          { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'Flash' }] },
        ],
        routableProviders: ['deepseek-official'],
      }),
    })
    const catalog = await loadModelCatalog(remote)
    expect(catalog.providers).toEqual([{ id: 'deepseek-official', name: 'DeepSeek' }])
  })

  it('keeps provider failures instead of rendering them as empty providers', async () => {
    const remote = fakeRemote({
      value: hostCatalog({
        groups: [{ id: 'ok', name: 'OK', models: [{ id: 'm', name: 'M' }] }],
        failures: [{ id: 'broken', name: '', message: 'unreachable: timeout' }],
      }),
    })
    const catalog = await loadModelCatalog(remote)
    expect(catalog.status).toBe('ready')
    expect(catalog.providers).toEqual([{ id: 'ok', name: 'OK' }])
    // The unnamed provider falls back to its id, and the reason survives.
    expect(catalog.failures).toEqual([{ id: 'broken', name: 'broken', message: 'unreachable: timeout' }])
  })

  it('carries the deployment default selection', async () => {
    const remote = fakeRemote({
      value: hostCatalog({ default: { provider: 'p', model: 'm', reasoningEffort: 'high' } }),
    })
    const catalog = await loadModelCatalog(remote)
    expect(catalog.default).toEqual({ provider: 'p', model: 'm' })
  })

  it('degrades to failed with the reason on the failure envelope', async () => {
    const remote = fakeRemote({ failure: { code: 'gateway/internal', message: 'no session' } })
    const catalog = await loadModelCatalog(remote)
    expect(catalog.status).toBe('failed')
    expect(catalog.error).toBe('gateway/internal: no session')
    expect(catalog.providers).toEqual([])
  })

  it('degrades to failed with the reason on a thrown transport error', async () => {
    const catalog = await loadModelCatalog(fakeRemote({ throws: new Error('socket closed') }))
    expect(catalog.status).toBe('failed')
    expect(catalog.error).toBe('socket closed')
  })

  it('re-reads on the same events the canonical model selector uses', () => {
    // The trigger set is the contract with the Host: a model configured in the
    // Models page (or a new credential) must reach the card without a reload.
    expect(CATALOG_REFRESH_EVENTS).toEqual([
      'llm/adapters-updated',
      'settings/document-updated',
      'credentials/reference-updated',
    ])
  })
})
