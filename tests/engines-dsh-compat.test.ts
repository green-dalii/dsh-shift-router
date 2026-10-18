/**
 * The DSH compatibility declaration, tested with the actual upstream judge.
 *
 * 0.2.1 changed the contract: when a bundle declares `engines.dsh`, that range
 * decides ALONE and `peerDependencies` are ignored (`dsh-app-boot`
 * `evaluatePluginCompatibility`, verbatim: "An own `engines.dsh` range decides
 * alone and peerDependencies are ignored ... Prereleases participate in
 * ranges", matched with `semver.satisfies(includePrerelease: true)`). A wrong
 * declaration skips the whole bundle at every profile boot, so the declaration
 * is a load-bearing artifact and gets its own gate instead of a docs note.
 *
 * The pinned runtime set is the shipped generations this plugin admits:
 * 0.2.0-rc.2 (first carrier of the plugins.row.config surface) and
 * 0.2.1-rc.2 (the current desktop). Negative cases pin the ceiling: 0.1.5-rc.2
 * hosts must reject (their shells were migrated away from in 0.2.0), and an
 * untested 0.3.0 generation must reject until audited.
 */

import {
  evaluatePluginCompatibility,
  pluginCompatibilityWarning,
} from '@deepseek-ai/dsh-app-boot'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  name: string
  version: string
  engines: { dsh?: string }
  peerDependencies?: Record<string, string>
}

const ADMITTED_RUNTIMES = ['0.2.0-rc.2', '0.2.1-rc.1', '0.2.1-rc.2'] as const
const REJECTED_RUNTIMES = ['0.1.5-rc.2', '0.3.0-rc.1', '0.3.0'] as const

describe('engines.dsh declaration (against the upstream evaluator)', () => {
  it('declares engines.dsh, so the range — not peers — decides on 0.2.1 hosts', () => {
    expect(manifest.engines?.dsh).toBe('>=0.2.0-rc.2 <0.3.0-rc.0')
  })

  it('admits every shipped runtime the plugins surface needs', () => {
    for (const runtime of ADMITTED_RUNTIMES) {
      const issue = evaluatePluginCompatibility(manifest, {}, runtime)
      expect(issue, `runtime ${runtime} must be compatible`).toBeUndefined()
    }
  })

  it('rejects runtimes outside the audited range', () => {
    for (const runtime of REJECTED_RUNTIMES) {
      const issue = evaluatePluginCompatibility(manifest, {}, runtime)
      expect(issue, `runtime ${runtime} must not be compatible`).toBeDefined()
      expect(issue?.requirements).toEqual({ 'engines.dsh': manifest.engines.dsh })
      expect(issue?.exempted).toBe(false)
    }
  })

  it('reports an actionable diagnostic for a rejected runtime', () => {
    const issue = evaluatePluginCompatibility(manifest, {}, '0.3.0')
    expect(issue).toBeDefined()
    if (issue === undefined) return
    // The exact English diagnostic the host logs; the remedy it names is the
    // `dsh plugin allow-version` exemption the maintainer must run on purpose.
    const warning = pluginCompatibilityWarning(issue)
    expect(warning).toContain(
      `Plugin ${manifest.name}@${manifest.version} is incompatible with dsh 0.3.0`,
    )
    expect(warning).toContain('Update the plugin or install a plugin version compatible with this dsh runtime')
  })
})
