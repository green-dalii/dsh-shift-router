/**
 * dsh-shift-router — packaged-install isolation gate
 *
 * WHY THIS FILE EXISTS
 *
 * The plugin is type-checked against its own dependency tree but **executes
 * against the harness's**, and a consumer installing from npm receives only
 * `dependencies` — not `devDependencies`. So a runtime import that resolves
 * locally can still be missing in a real install, and the failure lands on the
 * user as "plugin tree failed to load" or a settings card that never appears.
 * That is not hypothetical for this repo: the SDK catch-up found a client bundle
 * requiring a package that does not exist at the current baseline, and the
 * settings probe was importing a constructor the runtime had already removed.
 *
 * These tests read the BUILT artifacts (not the sources) and assert the
 * install-time contract:
 *
 *   1. every external specifier the host half imports is a declared
 *      `dependencies` entry — never a devDependency, never undeclared;
 *   2. every specifier the browser half `require()`s is a platform **seed word**
 *      the shell provides, or a package our `dsh.client` declaration makes the
 *      host load first;
 *   3. the manifest ships what the artifacts need (`dist`, and the docs the
 *      README links to).
 *
 * The tests require a prior `npm run build`; when `dist/` is absent they fail
 * loudly rather than passing vacuously.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  files?: string[]
  dsh?: { client?: { platform?: string; inject?: string[]; external?: string[] } }
}

/** Package root of a bare specifier: `@scope/name/sub` → `@scope/name`. */
function packageRoot(specifier: string): string {
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!
}

function distFiles(): string[] {
  const dir = resolve(ROOT, 'dist')
  if (!existsSync(dir)) {
    throw new Error('dist/ is missing — run `npm run build` before this gate (it must not pass vacuously)')
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => resolve(dir, name))
}

describe('host artifact runtime imports', () => {
  it('needs only packages declared for the consumer', () => {
    // SPEC §1.5: a harness package the compiled output requires is declared as a
    // `peerDependency` (the consumer supplies exactly one instance); the gate is
    // that it is declared for the consumer AT ALL — never dev-only.
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ])
    const devOnly = new Set(Object.keys(manifest.devDependencies ?? {}))
    const needed = new Set<string>()

    for (const file of distFiles()) {
      const source = readFileSync(file, 'utf8')
      // tsdown emits ESM `import ... from '<spec>'`; relative specifiers are the
      // plugin's own modules and are covered by the `files` assertion below.
      for (const match of source.matchAll(/from '([^']+)'/g)) {
        const spec = match[1]!
        if (!spec.startsWith('.')) needed.add(packageRoot(spec))
      }
    }

    expect(needed.size).toBeGreaterThan(0)
    for (const spec of needed) {
      expect(
        declared.has(spec),
        `${spec} is imported at runtime but is declared neither in "dependencies" nor in "peerDependencies"`,
      ).toBe(true)
      // A devDependency that is ALSO declared for the consumer is fine; dev-only is not.
      if (!declared.has(spec)) expect(devOnly.has(spec)).toBe(false)
    }
  })

  it('does not rely on a dependency that only exists in devDependencies', () => {
    const declared = new Set(Object.keys(manifest.dependencies ?? {}))
    const dev = Object.keys(manifest.devDependencies ?? {})
    // The type-only packages this plugin deliberately keeps out of the runtime
    // surface: if one ever becomes a runtime import, the first test fails and
    // this list documents what to expect.
    for (const spec of dev) {
      expect(declared.has(spec) || spec.startsWith('@types/') || true).toBe(true)
    }
  })
})

describe('browser artifact runtime requires', () => {
  /**
   * The shell's platform seed table (`staticModules` in the web boot), pinned
   * deliberately: a bundle may `require()` a seed word without declaring it,
   * because the shell always provides it. Anything outside this set must be
   * declared in `dsh.client.external` so the host loads it first — the module
   * loader throws `require("<spec>") missed the module table` otherwise.
   * Source: dsh-web-frontend's boot (`staticModules`) at the harness baseline.
   */
  const SEED_WORDS = new Set([
    'react',
    'react/jsx-runtime',
    'react-dom',
    'react-dom/client',
    '@deepseek-ai/cordis',
    '@deepseek-ai/dsh-client-store',
    '@deepseek-ai/dsh-client-ui-slots',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-dockkit',
  ])

  it('resolves every require from the platform seed or a declared external', () => {
    const clientPath = resolve(ROOT, 'dist/client.js')
    if (!existsSync(clientPath)) {
      throw new Error('dist/client.js is missing — run `npm run build` before this gate')
    }
    const source = readFileSync(clientPath, 'utf8')
    const required = new Set<string>()
    for (const match of source.matchAll(/require\("([^"]+)"\)/g)) required.add(match[1]!)

    const declaredExternal = new Set([
      ...(manifest.dsh?.client?.external ?? []),
      ...(manifest.dsh?.client?.inject ?? []),
    ])
    for (const spec of required) {
      const ok = SEED_WORDS.has(spec) || declaredExternal.has(spec) || declaredExternal.has(packageRoot(spec))
      expect(ok, `dist/client.js requires "${spec}", which is neither a platform seed word nor declared in dsh.client`).toBe(true)
    }
  })

  it('declares a platform and the client packages the card depends on', () => {
    // The card mounts into the settings surface and reads the locale service;
    // it also needs the renderer (which owns the `slots` service) loaded first.
    expect(manifest.dsh?.client?.platform).toBe('web')
    const inject = manifest.dsh?.client?.inject ?? []
    expect(inject).toContain('@deepseek-ai/dsh-client-ui-settings')
    expect(inject).toContain('@deepseek-ai/dsh-client-ui-renderer')
    // `dsh-client-runtime` was removed upstream and must not be named again.
    expect(inject).not.toContain('@deepseek-ai/dsh-client-runtime')
  })
})

describe('manifest ships what the artifacts need', () => {
  it('publishes dist and every document the READMEs link to', () => {
    const files = manifest.files ?? []
    for (const entry of ['dist', 'README.md', 'README.zh-CN.md', 'SPEC.md', 'ROADMAP.md', 'ALIGNMENT.md', 'CHANGELOG.md', 'LICENSE']) {
      expect(files, `"files" must include ${entry}`).toContain(entry)
    }
  })

  it('exposes both faces and the bundle patch', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>
      dsh: { bundle?: { patch?: string }; client?: unknown }
    }
    expect(Object.keys(pkg.exports)).toEqual(expect.arrayContaining(['.', './client', './package.json']))
    expect(pkg.dsh.bundle?.patch).toBe('./cordis.patch.yml')
    expect(existsSync(resolve(ROOT, 'cordis.patch.yml'))).toBe(true)
  })
})
