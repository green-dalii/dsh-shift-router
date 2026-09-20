#!/usr/bin/env node
/**
 * dsh-shift-router — real-browser check for the settings card (opt-in)
 *
 * WHY THIS EXISTS
 *
 * Three defects shipped that no gate could see, because all three were only
 * visible in a browser: the card registered into the wrong slot (invisible), a
 * model row's badge covered its provider select, and every unit suffix sat under
 * the spin buttons of its number input (ALIGNMENT §R6, §R7, §R8). The first is
 * now caught by a unit test; the layout ones can only be measured by a layout
 * engine — which is what this script does.
 *
 * It boots a scratch profile (or takes a running server's URL), opens
 * Settings → Plugins → Plugin configuration, expands the card, and asserts:
 *
 *   1. the card is there and expands;
 *   2. NO two of its innermost visible elements overlap (bounding boxes), and no
 *      text element's content spills out of its own box;
 *   3. the deployment's providers reach the provider dropdown (the catalog is
 *      really loaded, not just typed in).
 *
 * Deliberately NOT part of `npm test` / `npm run test:e2e`: those must run
 * without a browser. Run it when you touch ShiftRouterCard.tsx.
 *
 * Usage:
 *   node e2e/browser-check.mjs                       # scratch profile + boot
 *   node e2e/browser-check.mjs --url '<token url>'   # an existing server
 *   node e2e/browser-check.mjs --shots /tmp/shots    # screenshot directory
 *   node e2e/browser-check.mjs --keep                # keep the scratch DSH_HOME
 *
 * Requires `playwright-core` (or PLAYWRIGHT_CORE=<path to its index.mjs>).
 * Exit code 0 = pass.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const DSH = process.env.DSH_BIN ?? 'dsh'

/** Candidate Chromium builds, newest first; `--chrome <path>` overrides. */
const CHROME_CANDIDATES = [
  join(process.env.HOME ?? '', 'Library/Caches/ms-playwright'),
]

function parseArgs(argv) {
  const args = { keep: false, url: undefined, shots: '/tmp/shift-router-browser', chrome: undefined }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--keep') args.keep = true
    else if (arg === '--url') args.url = argv[++i]
    else if (arg === '--shots') args.shots = argv[++i]
    else if (arg === '--chrome') args.chrome = argv[++i]
  }
  return args
}

/** Load playwright-core from the project, the environment, or a sibling checkout. */
async function loadPlaywright() {
  const override = process.env.PLAYWRIGHT_CORE
  if (override !== undefined) return import(override)
  try {
    return await import('playwright-core')
  } catch {
    /* fall through to a helpful failure */
  }
  throw new Error(
    'playwright-core is not installed. Run `npm i -D playwright-core` (or set PLAYWRIGHT_CORE to its index.mjs).',
  )
}

/** Find a usable Chromium: an explicit path, then the playwright cache. */
function findChrome(explicit) {
  if (explicit !== undefined) return explicit
  for (const root of CHROME_CANDIDATES) {
    if (!existsSync(root)) continue
    const builds = readdirSync(root).filter((name) => name.startsWith('chromium-')).sort().reverse()
    for (const build of builds) {
      for (const rel of [
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        'chrome-linux/chrome',
      ]) {
        const candidate = join(root, build, rel)
        if (existsSync(candidate)) return candidate
      }
    }
  }
  return undefined
}

function run(args, { env = {}, allowFailure = false } = {}) {
  return new Promise((done) => {
    const child = spawn(DSH, args, { cwd: REPO, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', (error) => done({ code: -1, output: `${output}\n${error.message}` }))
    child.on('close', (code) => {
      if (code !== 0 && !allowFailure) console.error(`✗ ${DSH} ${args.join(' ')}\n${output}`)
      done({ code, output })
    })
  })
}

/** Run the serving profile until it prints its URL, then keep it alive. */
function serve(args, home, budgetMs = 60_000) {
  const child = spawn(DSH, args, { cwd: REPO, env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] })
  return new Promise((done, fail) => {
    let output = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail(new Error(`server did not start:\n${output}`)) }, budgetMs)
    const poll = setInterval(() => {
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/)
      if (match === null) return
      clearTimeout(timer)
      clearInterval(poll)
      done({ child, url: match[1] })
    }, 200)
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', (error) => { clearTimeout(timer); clearInterval(poll); fail(error) })
  })
}

/**
 * Click through the first-run modals (beta notice, API-key onboarding) so the
 * settings panel is reachable without a configured deployment.
 */
async function dismissModals(page) {
  const labels = ['稍后配置', '稍后', '继续', '知道了', '我知道了', '跳过', '完成', '关闭', 'Later', 'Continue', 'Got it', 'Skip', 'Done', 'Close']
  for (let round = 0; round < 6; round += 1) {
    const dialog = page.locator('[role="dialog"]:visible').first()
    if ((await dialog.count()) === 0) return
    for (const label of labels) {
      const button = dialog.locator(`button:has-text("${label}")`).first()
      if ((await button.count()) > 0 && (await button.isVisible())) {
        await button.click().catch(() => {})
        break
      }
    }
    await page.waitForTimeout(600)
  }
}

/**
 * Measure the card's layout twice over, because the two failure modes are
 * different and one hides from the other:
 *
 *   - `overlaps` compares bounding boxes of the innermost visible elements
 *     (ancestor/descendant pairs are excluded by construction), which catches an
 *     overlay on a native control — e.g. a unit suffix inside a number input;
 *   - `clipped` compares each text element's scroll size with its client size,
 *     which catches a box too small for its content — e.g. a nowrap label in a
 *     fixed grid track, where the ink spills but the BOX stays put and the
 *     intersection test sees nothing.
 *
 * Both are needed: the defect that shipped was one of each.
 */
const DETECT_OVERLAPS = () => {
  const root = document.querySelector('.sr-card')
  if (root === null) return { error: 'the Shift-Router card is not on the page' }
  const tags = new Set(['SPAN', 'P', 'LABEL', 'INPUT', 'SELECT', 'BUTTON', 'SVG', 'H3', 'H4', 'LI', 'CODE'])
  const leaves = [...root.querySelectorAll('*')].filter((el) => {
    if (!tags.has(el.tagName) || el.offsetParent === null) return false
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return false
    return ![...el.querySelectorAll('*')].some((child) => tags.has(child.tagName) && child.offsetParent !== null)
  })
  const boxes = leaves.map((el) => {
    const rect = el.getBoundingClientRect()
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.textContent ?? '').trim().slice(0, 24),
      x: rect.x, y: rect.y, w: rect.width, h: rect.height,
    }
  })
  const overlaps = []
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]
      const b = boxes[j]
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      if (ox > 2 && oy > 2) {
        overlaps.push(`${a.tag}("${a.text}") ∩ ${b.tag}("${b.text}") = ${Math.round(ox)}×${Math.round(oy)}px`)
      }
    }
  }

  // Text-bearing, non-interactive elements only: a text input legitimately
  // scrolls a long value, and a select's own metrics are not ours to police.
  const textTags = new Set(['SPAN', 'P', 'LABEL', 'H3', 'H4', 'CODE'])
  const clipped = leaves
    .filter((el) => textTags.has(el.tagName))
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.textContent ?? '').trim().slice(0, 24),
      overX: el.scrollWidth - el.clientWidth,
      overY: el.scrollHeight - el.clientHeight,
    }))
    .filter((row) => row.overX > 1 || row.overY > 2)
    .map((row) => `${row.tag}("${row.text}") spills ${row.overX}×${row.overY}px`)

  return { boxes: boxes.length, overlaps, clipped }
}

const results = []
function check(ok, message) {
  results.push(ok)
  console.log(`  ${ok ? '✓' : '✗'} ${message}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { chromium } = await loadPlaywright()
  const chrome = findChrome(args.chrome)

  let home
  let server
  try {
    let url = args.url
    if (url === undefined) {
      home = mkdtempSync(join(tmpdir(), 'shift-router-browser-'))
      console.log(`\n▸ scratch DSH_HOME: ${home}`)
      await run(['--profile', 'browser-check', '--from-default-profile', 'web'], { env: { DSH_HOME: home }, allowFailure: true })
      const added = await run(['plugin', '--profile', 'browser-check', 'add', REPO], { env: { DSH_HOME: home } })
      if (added.code !== 0) throw new Error('could not install the plugin into the scratch profile')
      server = await serve(['--profile', 'browser-check', '--port', '0', '--no-open'], home)
      url = server.url
    }

    const browser = await chromium.launch({ executablePath: chrome, headless: true })
    const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } })
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)
    await dismissModals(page)

    await page.locator('button[aria-label="设置"], button[aria-label="Settings"]').first().click({ timeout: 20_000 })
    await page.waitForTimeout(1200)
    await page.locator('button', { hasText: /插件|Plugins/ }).first().click()
    await page.waitForTimeout(1200)

    const header = page.locator('button[aria-label^="展开设置: Shift-Router"], button[aria-label^="Show settings: Shift-Router"]').first()
    check((await header.count()) > 0, 'the card is registered on the plugin configuration tab')
    await header.click()
    await page.waitForTimeout(1000)

    // Two rows in the Fast chain: the row controls (and the overlap risk) only
    // exist once a row does.
    const add = page.locator('.sr-addModel').first()
    for (let i = 0; i < 2; i += 1) { await add.click(); await page.waitForTimeout(300) }
    await page.waitForTimeout(600)

    const layout = await page.evaluate(DETECT_OVERLAPS)
    if (layout.error !== undefined) {
      check(false, layout.error)
    } else {
      check(layout.overlaps.length === 0, `no overlapping elements among ${layout.boxes} boxes`)
      for (const line of layout.overlaps.slice(0, 12)) console.log(`      ${line}`)
      check(layout.clipped.length === 0, 'no text spills out of its own box')
      for (const line of layout.clipped.slice(0, 12)) console.log(`      ${line}`)
    }

    // The provider select must offer the deployment's models: the catalog really
    // reached the browser, which is what "make me type ids by hand" was about.
    const options = await page.locator('.sr-card select').first().locator('option').allInnerTexts()
    check(options.filter((text) => !/自定义|Custom/.test(text)).length > 0,
      `the provider dropdown lists the deployment's providers (${options.length} options)`)

    const layout2 = await page.evaluate(DETECT_OVERLAPS)
    check(layout2.overlaps.length === 0, `no overlapping elements after re-measuring (${layout2.boxes} boxes)`)
    check(layout2.clipped.length === 0, 'no text spills out of its own box after re-measuring')

    const shots = args.shots
    await page.screenshot({ path: join(shots, 'card-collapsed-light.png'), fullPage: true })
    await page.screenshot({ path: join(shots, 'card-open-light.png'), fullPage: true })
    console.log(`\n  screenshots: ${shots}`)
    await browser.close()
  } finally {
    server?.child.kill('SIGTERM')
    if (home !== undefined && !args.keep) rmSync(home, { recursive: true, force: true })
    else if (home !== undefined) console.log(`  kept the scratch home: ${home}`)
  }

  const failed = results.filter((ok) => !ok).length
  console.log(failed === 0 ? '\nBROWSER CHECK PASSED' : `\nBROWSER CHECK FAILED (${failed})`)
  process.exitCode = failed === 0 ? 0 : 1
}

await main()
