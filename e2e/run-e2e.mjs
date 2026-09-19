#!/usr/bin/env node
/**
 * dsh-shift-router — credential-free end-to-end verification
 *
 * Proves the packaged plugin installs into a scratch DSH profile and routes a
 * real turn, with no API key anywhere:
 *
 *   1. build a throwaway DSH_HOME + a derived `headless` profile
 *   2. install THIS checkout as a bundle (`dsh plugin add`)
 *   3. run one turn under `--patch e2e/overlay.yml` (fake LLM adapter)
 *   4. assert the turn ran on the Smart tier model — i.e. the Judge ran, the EV
 *      rule escalated, and the wire model was actually switched
 *   5. assert the `shift-router` settings namespace round-trips a write
 *
 * Usage:
 *   node e2e/run-e2e.mjs            # scratch home under the OS temp dir
 *   node e2e/run-e2e.mjs --keep     # keep it for inspection
 *   DSH_BIN=/path/to/dsh node e2e/run-e2e.mjs
 *
 * Exit code 0 = pass. The scratch home is deleted unless --keep is passed, so
 * this never touches the user's real DSH_HOME.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const DSH = process.env.DSH_BIN ?? 'dsh'
const KEEP = process.argv.includes('--keep')
const PROFILE = 'shift-router-e2e'

const home = mkdtempSync(join(tmpdir(), 'shift-router-e2e-'))
const probeOut = join(home, 'settings-probe.json')

/** Run one command, streaming nothing, returning {code, output}. */
function run(args, { allowFailure = false, env = {} } = {}) {
  return new Promise((done) => {
    const child = spawn(DSH, args, {
      cwd: REPO,
      env: { ...process.env, DSH_HOME: home, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', (error) => done({ code: -1, output: `${output}\n${error.message}` }))
    child.on('close', (code) => {
      if (code !== 0 && !allowFailure) {
        console.error(`✗ ${DSH} ${args.join(' ')}\n${output}`)
        process.exitCode = 1
      }
      done({ code, output })
    })
  })
}

const step = (message) => console.log(`\n▸ ${message}`)

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`)
    return
  }
  console.error(`  ✗ ${message}`)
  process.exitCode = 1
}

try {
  step(`scratch DSH_HOME: ${home}`)
  step(`deriving the "${PROFILE}" profile from the headless template`)
  // The CLI reports "a task is required" after building the profile; that is
  // expected here and the profile files are what we are after.
  await run(['--profile', PROFILE, '--from-default-profile', 'headless'], { allowFailure: true })

  step('installing this checkout as a bundle')
  const added = await run(['plugin', '--profile', PROFILE, 'add', REPO])
  assert(added.code === 0, 'dsh plugin add succeeded')

  step('running one turn on the fake adapter (no credentials)')
  const turn = await run(
    ['--profile', PROFILE, '--patch', join(HERE, 'overlay.yml'),
      'design a migration plan for our billing system'],
    { env: { SHIFT_ROUTER_E2E_PROBE_OUT: probeOut } },
  )
  const line = turn.output.split('\n').find((l) => l.includes('ROUTER-E2E:'))?.trim() ?? ''
  console.log(`  output: ${line || '(nothing)'}`)
  assert(line.includes('ROUTER-E2E: turn ran on fake/fake-smart'),
    'the Judge ran, the EV rule escalated, and the turn ran on the Smart tier model')

  step('checking the settings namespace round-trip')
  let probe = null
  try {
    probe = JSON.parse(readFileSync(probeOut, 'utf8'))
  } catch {
    // left null — reported below
  }
  console.log(`  probe: ${probe ? JSON.stringify(probe) : '(no result file)'}`)
  assert(probe?.ok === true, `settings round-trip ok (${probe?.detail ?? 'missing'})`)
} finally {
  if (KEEP) {
    console.log(`\nkept the scratch home: ${home}`)
  } else {
    rmSync(home, { recursive: true, force: true })
  }
}

console.log(process.exitCode === 1 ? '\nE2E FAILED' : '\nE2E PASSED')
