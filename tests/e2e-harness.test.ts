/**
 * dsh-shift-router — invariants of the e2e harness itself (SPEC §14)
 *
 * The e2e is the gate that caught the boot-aborting defect (§R3), which makes it
 * worth trusting — and therefore worth testing. It is also a *script*, so nothing
 * else in the suite looks at it: a step that boots a server instead of exiting is
 * invisible to 400+ unit tests and only shows up as a CI run that burns the
 * platform's six-hour job limit.
 *
 * That is not hypothetical. Run 35823766557 passed every routing assertion,
 * packed the tarball, then sat for six hours inside the packed-artifact step on
 * `dsh --profile … --from-default-profile web` — which BOOTS the `web` template
 * (server + browser) and never returns. These tests pin the properties that would
 * have caught it, against the script's real source rather than a copy of it.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(resolve(REPO, 'e2e/run-e2e.mjs'), 'utf8')
const workflow = readFileSync(resolve(REPO, '.github/workflows/ci.yml'), 'utf8')

/**
 * The argument list of every `run([...])` and `runBounded([...])` call, each
 * tagged with which helper it used — the distinction is the whole point: a boot
 * must go through the bounded helper, a one-shot step through `run`.
 */
function calls(): { helper: 'run' | 'runBounded'; args: string[] }[] {
  return [...source.matchAll(/\brun(Bounded)?\(\s*(\[[^\]]*\])/g)].map((match) => ({
    helper: match[1] === 'Bounded' ? 'runBounded' : 'run',
    args: match[2]!,
  }))
}

/** Calls that are expected to exit on their own (never a serving boot). */
function oneShotArgLists(): string[] {
  return calls().filter((call) => call.helper === 'run').map((call) => call.args)
}

describe('the e2e cannot hang the CI job', () => {
  it('bounds every one-shot command, so a stall is named rather than waited out', () => {
    // `run()` used to resolve only on `close`, so a blocked `dsh plugin add` had
    // no ceiling at all. The budget is the reason a stall is a diagnosis.
    expect(source).toMatch(/function run\([\s\S]{0,200}?budgetMs/)
    expect(source).toMatch(/did not finish within[\s\S]{0,900}?process\.exit\(1\)/)
    // …and the name of the stalled step goes in the message.
    expect(source).toContain('did not finish within')
  })

  it('labels the install steps that reach the network', () => {
    const adds = oneShotArgLists().filter((args) => args.includes("'plugin'"))
    expect(adds.length).toBeGreaterThanOrEqual(2)
    for (const args of adds) {
      // A bare `run(['plugin', …])` would report a stall as an anonymous argv.
      const line = source.slice(source.indexOf(args)).split('\n')[0]!
      expect(line, `unlabelled install: ${args}`).toContain('label:')
    }
  })

  it('never derives a profile from a template that serves', () => {
    // `--from-default-profile <t>` BOOTS t. For `web` that is a server and a
    // browser — the six-hour stall. `--dump-config` materializes the identical
    // profile and exits, so the web composition is kept and the step ends.
    const derivations = oneShotArgLists().filter((args) => args.includes('--from-default-profile'))
    expect(derivations.length).toBeGreaterThanOrEqual(2)
    for (const args of derivations) {
      const serves = args.includes("'web'") && !args.includes('--dump-config')
      expect(serves, `a one-shot step derives from a serving template: ${args}`).toBe(false)
    }
  })

  it('boots only through the bounded, port-zeroed serving path', () => {
    // The real boot must keep `--port 0` (never collides with a running harness)
    // and `--no-open`, and must go through runBounded, which kills the child.
    const boots = calls().filter((call) => call.args.includes('--no-open'))
    expect(boots.length).toBeGreaterThanOrEqual(1)
    for (const boot of boots) {
      expect(boot.helper, `a boot bypasses runBounded: ${boot.args}`).toBe('runBounded')
      expect(boot.args, `a boot is not port-zeroed: ${boot.args}`).toContain("'--port'")
    }
    expect(source).toMatch(/function runBounded\(/)
  })

  it('keeps the job under the platform limit, as a backstop', () => {
    // `continue-on-error` governs whether a failure blocks the build; it does NOT
    // bound wall-clock time. A hung job still runs until GitHub cancels it at six
    // hours, so the timeout has to be declared.
    expect(workflow).toMatch(/timeout-minutes:\s*20/)
    expect(workflow).toMatch(/continue-on-error:\s*true/)
    // …and the blocking gate is still a different job.
    expect(workflow).toMatch(/gates/)
  })
})
