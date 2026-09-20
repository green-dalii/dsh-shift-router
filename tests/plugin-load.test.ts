/**
 * dsh-shift-router — plugin load (wiring) tests
 *
 * WHY THIS FILE EXISTS
 *
 * Every other test in this repo calls a pure function with a hand-written
 * object. That cannot catch a whole class of plugin bugs, because a Cordis
 * context is a PROXY whose `get` trap throws
 *
 *     cannot get property "<name>" without inject
 *
 * for any service the plugin did not declare in `inject`. A structural cast
 * (`ctx as unknown as { someService?: ... }`) silences TypeScript but NOT that
 * trap: the property read still throws at runtime. Because the read happened
 * inside `apply`, the throw failed the plugin fiber and aborted the entire DSH
 * boot ("plugin tree failed to load") — on the DEFAULT configuration
 * (`orchestration.mode: auto`), i.e. for every user.
 *
 * The only way to catch that is to load the plugin the way the loader does:
 * against a real context, with the real `inject` gate armed. This file does
 * exactly that, and it is deliberately the cheapest possible version of it
 * (no harness, no adapters, no turn) so it runs in milliseconds.
 *
 * The two cases mirror the two compositions that actually ship:
 *   - `web`      mounts `@deepseek-ai/dsh-tool-subagent/model-selection-settings`,
 *                so `subagentModelSelection` resolves (this is what crashed);
 *   - `headless` does not mount it, so the service must be treated as absent.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import * as plugin from '../src/index.js'

/** The config that triggered the boot failure: orchestration on its default mode. */
function autoConfig() {
  return {
    enabled: true,
    tiers: {
      fast: { label: 'Fast', models: [{ provider: 'fake', model: 'fake-fast', priority: 1 }] },
      smart: { label: 'Smart', models: [{ provider: 'fake', model: 'fake-smart', priority: 1 }] },
    },
    routing: { mode: 'auto' },
    orchestration: { mode: 'auto' },
  }
}

/** What the plugin registered on the system-prompt service during `apply`. */
interface PromptCapture {
  sections: { name: string; order: number }[]
  variables: string[]
}

/**
 * A root context with the services the plugin REQUIRES (`export const inject`),
 * and nothing else. Anything the plugin reads beyond this list must go through
 * an optional probe (`ctx.get`) or it will throw — which is the point.
 */
function harnessContext(
  extra: Record<string, unknown> = {},
): { ctx: Context; prompt: PromptCapture } {
  const ctx = new Context()
  const prompt: PromptCapture = { sections: [], variables: [] }
  ctx.provide('llm', {
    resolveModelInfo: async () => undefined,
    listProviders: () => [],
    listModels: async () => [],
    stream: async function* stream() {},
  })
  ctx.provide('tools', { get: () => undefined })
  ctx.provide('commands', { register: () => () => undefined })
  ctx.provide('agents', { get: () => undefined })
  ctx.provide('systemPrompt', {
    section: (section: { name: string; order: number }) => {
      prompt.sections.push({ name: section.name, order: section.order })
      return () => undefined
    },
    variable: (name: string) => {
      prompt.variables.push(name)
      return () => undefined
    },
  })
  for (const [name, value] of Object.entries(extra)) ctx.provide(name, value)
  return { ctx, prompt }
}

describe('plugin load against a real Cordis context', () => {
  it('loads on a composition WITHOUT the model-selection service (headless)', async () => {
    const { ctx } = harnessContext()
    await expect(ctx.plugin(plugin, autoConfig())).resolves.toBeDefined()
  })

  it('loads on a composition WITH the model-selection service (web)', async () => {
    const { ctx } = harnessContext({
      subagentModelSelection: { current: () => ({ enabled: false, allowedModels: [] }) },
    })
    await expect(ctx.plugin(plugin, autoConfig())).resolves.toBeDefined()
  })

  it('loads when the service mounts AFTER this plugin (the boot-order race that broke web)', async () => {
    // `web` mounts this plugin and the `subagent-model-selection-settings` row
    // in the same include group, loaded concurrently. If our `apply` runs first
    // the service is momentarily absent — and an undeclared read throws, which
    // aborts the whole plugin tree. Loading it afterwards here reproduces
    // exactly that ordering.
    const { ctx } = harnessContext()
    await expect(ctx.plugin(plugin, autoConfig())).resolves.toBeDefined()
    ctx.provide('subagentModelSelection', { current: () => ({ enabled: false, allowedModels: [] }) })
  })

  it('warns once when orchestration is on and delegation is not model-selectable (SPEC §7.4)', async () => {
    const { ctx } = harnessContext({
      subagentModelSelection: { current: () => ({ enabled: false, allowedModels: [] }) },
    })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    await ctx.plugin(plugin, autoConfig())
    const warned = warn.mock.calls.map((call) => call.map(String).join(' ')).join('\n')
    expect(warned).toContain('subagent-model-selection')
    warn.mockRestore()
  })

  it('stays silent when the allowlist is enabled with routes', async () => {
    const { ctx } = harnessContext({
      subagentModelSelection: {
        current: () => ({ enabled: true, allowedModels: [{ provider: 'fake', model: 'fake-fast' }] }),
      },
    })
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => undefined)
    await ctx.plugin(plugin, autoConfig())
    const warned = warn.mock.calls.map((call) => call.map(String).join(' ')).join('\n')
    expect(warned).not.toContain('subagent-model-selection')
    warn.mockRestore()
  })
})
