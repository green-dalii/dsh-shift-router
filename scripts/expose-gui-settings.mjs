#!/usr/bin/env node
/**
 * dsh-shift-router — expose the GUI settings card to the Web client
 *
 * Upstream limitation (DeepSeek Harness 0.1.0-rc.6): the Web API proxy
 * (`@deepseek-ai/dsh-host-apiproxy`) deliberately whitelists which settings
 * namespaces the browser may read and write (`WEB_SETTINGS_NAMESPACES`).
 * A plugin cannot self-expose its namespace in this version — the apiproxy's
 * own comment calls moving that decision to `settings.register()` "deferred
 * work". The official cards (`shell`, `agent-loop`, `web-search-deepseek`)
 * are on the list; a third-party namespace is filtered out of the browser's
 * `settings.describe` response, so the card's scope reports `unavailable`.
 *
 * This script patches the whitelist in one profile's installed copy of the
 * package (idempotent): it adds the `shift-router` namespace to
 * `WEB_SETTINGS_NAMESPACES`. The profile must then be restarted (the apiproxy
 * is loaded at boot). Re-running after a reinstall is safe — the script
 * detects the namespace is already present and does nothing.
 *
 * Usage:
 *   node scripts/expose-gui-settings.mjs                  # DSH_HOME + profile web
 *   node scripts/expose-gui-settings.mjs --profile web    # explicit profile
 *   DSH_HOME=/tmp/scratch node scripts/expose-gui-settings.mjs --profile web-e2e
 *
 * Flags:
 *   --profile <name>   profile to patch (default: web)
 *   --home <path>      DSH_HOME (default: $DSH_HOME or ~/.dsh)
 *   --dry-run          print what would change without writing
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const GUI_SETTINGS_NAMESPACE = 'shift-router'
const APIPROXY_REL = join('node_modules', '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js')

/**
 * Add the GUI namespace to the `WEB_SETTINGS_NAMESPACES` array literal.
 * @param source - the apiproxy index.js source.
 * @returns the new source and whether it changed.
 */
export function patchWhitelist(source) {
  const marker = 'const WEB_SETTINGS_NAMESPACES = ['
  const start = source.indexOf(marker)
  if (start === -1) throw new Error('WEB_SETTINGS_NAMESPACES not found in apiproxy index.js')
  const open = start + marker.length
  const close = source.indexOf(']', open)
  if (close === -1) throw new Error('unterminated WEB_SETTINGS_NAMESPACES array')
  const body = source.slice(open, close)
  const entries = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1])
  if (entries.includes(GUI_SETTINGS_NAMESPACE)) return { source, changed: false }
  // Insert right after the opening bracket (`[\n\t"shift-router", …`) — always
  // syntactically valid regardless of the original array's trailing commas.
  const insert = `\n\t"${GUI_SETTINGS_NAMESPACE}",`
  return { source: source.slice(0, open) + insert + source.slice(open), changed: true }
}

/** Locate the apiproxy index.js under a profile (profile-local node_modules first). */
function findApiProxy(profileDir) {
  const candidates = [
    join(profileDir, APIPROXY_REL),
    join(dirname(profileDir), APIPROXY_REL), // hoisted workspace root
  ]
  return candidates.find((path) => existsSync(path))
}

function parseArgs(argv) {
  const args = { profile: 'web', dryRun: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--profile') args.profile = argv[++i]
    else if (arg === '--home') args.home = argv[++i]
    else if (arg === '--dry-run') args.dryRun = true
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const home = resolve(args.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
  const profileDir = join(home, 'profiles', args.profile)
  const target = findApiProxy(profileDir)

  if (!target) {
    console.error(`expose-gui-settings: no dsh-host-apiproxy found under ${profileDir}`)
    console.error('  (is the profile installed? run `dsh plugin --profile <name> add ./dsh-shift-router` first)')
    process.exit(1)
  }

  let source
  try {
    source = readFileSync(target, 'utf8')
  } catch (error) {
    console.error(`expose-gui-settings: cannot read ${target}: ${error.message}`)
    process.exit(1)
  }

  let changed
  try {
    ;({ source, changed } = patchWhitelist(source))
  } catch (error) {
    console.error(`expose-gui-settings: ${error.message}`)
    process.exit(1)
  }

  if (!changed) {
    console.log(`expose-gui-settings: ${GUI_SETTINGS_NAMESPACE} already exposed in ${target}`)
    process.exit(0)
  }
  if (args.dryRun) {
    console.log(`expose-gui-settings: would add "${GUI_SETTINGS_NAMESPACE}" to WEB_SETTINGS_NAMESPACES in ${target}`)
    process.exit(0)
  }

  try {
    writeFileSync(target, source, 'utf8')
  } catch (error) {
    console.error(`expose-gui-settings: cannot write ${target}: ${error.message}`)
    process.exit(1)
  }
  console.log(`expose-gui-settings: added "${GUI_SETTINGS_NAMESPACE}" to WEB_SETTINGS_NAMESPACES in ${target}`)
  console.log('  restart the profile for the change to take effect.')
}

// Run as a script only when invoked directly (also importable for tests).
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
