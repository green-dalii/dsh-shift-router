/**
 * dsh-shift-router — route notice formatting (SPEC §13.1)
 *
 * A routing switch is a fact about the user's session, so it is written into the
 * session. These tests pin the two properties that make the notice useful rather
 * than decorative:
 *
 * 1. It says WHICH plugin wrote it. `source.plugin` is durable but the Chat
 *    client never renders it (`NoticeBody` draws only the content, the collapsed
 *    row only `summary`), so the text itself has to carry `[shift-router]` —
 *    otherwise it reads as harness output, which is exactly the confusion this
 *    feature exists to end.
 * 2. It says WHAT changed and WHY, in the fields that make a switch auditable:
 *    the tier transition, the model transition (abbreviated the way the
 *    harness's own notice abbreviates it), the action, the Judge's verdict and
 *    reason, and the wall time the decision took.
 */

import { describe, expect, it } from 'vitest'
import { CONTEXT_SUMMARY_MAX_CHARS } from '@deepseek-ai/dsh-llm'
import {
  formatRouteNotice,
  routeChanged,
  type RouteNoticeInput,
} from '../src/notice.js'

/** Labels as the deployment configures them, so nothing is hardcoded. */
const LABELS = { fast: 'Fast', smart: 'Smart' }

function input(overrides: Partial<RouteNoticeInput> = {}): RouteNoticeInput {
  return {
    action: 'upgrade',
    fromTier: 'fast',
    fromProvider: 'opencode-go',
    fromModel: 'deepseek-v4-flash',
    toTier: 'smart',
    toProvider: 'opencode-go',
    toModel: 'deepseek-v4-pro',
    judgeTier: 'smart',
    judgeSource: 'llm',
    confidence: 0.85,
    reason: 'user asked for depth',
    held: false,
    elapsedMs: 412,
    ...overrides,
  }
}

describe('routeChanged', () => {
  it('is true when the tier moves', () => {
    expect(routeChanged(input())).toBe(true)
  })

  it('is true when only the model moves within a tier (a chain fallback)', () => {
    expect(routeChanged(input({
      action: 'stay',
      toTier: 'fast',
      toModel: 'deepseek-v4-flash-lite',
    }))).toBe(true)
  })

  it('is false when the route is unchanged', () => {
    expect(routeChanged(input({
      action: 'stay',
      toTier: 'fast',
      toModel: 'deepseek-v4-flash',
      fromTier: 'fast',
    }))).toBe(false)
  })

  it('is true on the first turn, where there is no previous model', () => {
    expect(routeChanged(input({
      action: 'stay',
      fromModel: null,
      fromProvider: null,
      toTier: 'fast',
      toModel: 'deepseek-v4-flash',
    }))).toBe(true)
  })

  it('is false when no model could be resolved at all (an empty chain)', () => {
    // Otherwise a deployment whose Fast chain is empty would get an `initial`
    // notice on every single turn, and `initial` would be untrue by turn 9.
    expect(routeChanged(input({
      action: 'stay',
      fromModel: null,
      fromProvider: null,
      toTier: 'fast',
      toModel: null,
      toProvider: null,
    }))).toBe(false)
  })
})

describe('formatRouteNotice — the switch', () => {
  it('names the plugin first, so the row is attributable', () => {
    expect(formatRouteNotice(input(), LABELS).text.startsWith('[shift-router] ')).toBe(true)
  })

  it('states the tier transition with the configured labels', () => {
    const { text } = formatRouteNotice(input(), { fast: '快', smart: '强' })
    expect(text).toContain('快 → 强')
  })

  it('states the model transition, the action, the Judge verdict and the time', () => {
    const { text } = formatRouteNotice(input(), LABELS)
    expect(text).toContain('deepseek-v4-flash → deepseek-v4-pro')
    expect(text).toContain('upgrade')
    expect(text).toContain('judge smart')
    expect(text).toContain('conf=0.85')
    expect(text).toContain('user asked for depth')
    expect(text).toContain('412ms')
  })

  it('abbreviates models to their bare id while the provider is unchanged', () => {
    const { text } = formatRouteNotice(input(), LABELS)
    expect(text).not.toContain('opencode-go')
  })

  it('qualifies both sides with the provider when it changes', () => {
    const { text } = formatRouteNotice(input({
      toProvider: 'command-code',
      toModel: 'claude-opus-5',
    }), LABELS)
    expect(text).toContain('opencode-go/deepseek-v4-flash')
    expect(text).toContain('command-code/claude-opus-5')
  })

  it('reports a first turn as the route being established, not as a switch', () => {
    const { text } = formatRouteNotice(input({
      action: 'stay',
      fromTier: 'fast',
      fromProvider: null,
      fromModel: null,
      toTier: 'fast',
      toModel: 'deepseek-v4-flash',
    }), LABELS)
    expect(text).toContain('initial')
    expect(text).toContain('deepseek-v4-flash')
    expect(text).not.toContain('→ deepseek-v4-flash →')
  })

  it('omits the Judge fields the Judge did not give rather than printing empties', () => {
    const { text } = formatRouteNotice(input({ confidence: undefined, reason: undefined }), LABELS)
    expect(text).not.toContain('conf=')
    expect(text).not.toContain('""')
    expect(text).not.toContain('undefined')
  })

  it('marks a fallback verdict, because "no signal" is why the router held', () => {
    const { text } = formatRouteNotice(input({
      judgeSource: 'fallback',
      confidence: undefined,
      reason: undefined,
    }), LABELS)
    expect(text).toContain('judge fallback')
  })

  it('surfaces the orchestration signal, which changes what the turn does', () => {
    expect(formatRouteNotice(input({ orchestrate: true }), LABELS).text).toContain('orchestrate')
    expect(formatRouteNotice(input({ orchestrate: false }), LABELS).text).not.toContain('orchestrate')
  })
})

describe('formatRouteNotice — the held turn', () => {
  const held = input({
    action: 'stay',
    toTier: 'fast',
    toProvider: 'opencode-go',
    toModel: 'deepseek-v4-flash',
    fromTier: 'fast',
    judgeSource: 'fallback',
    confidence: undefined,
    reason: undefined,
    held: true,
  })

  it('says the router kept its position, and still names the plugin', () => {
    const { text } = formatRouteNotice(held, LABELS)
    expect(text.startsWith('[shift-router] ')).toBe(true)
    expect(text).toContain('hold')
    expect(text).toContain('Fast')
    expect(text).toContain('deepseek-v4-flash')
  })

  it('does not draw a transition arrow for a position that did not move', () => {
    expect(formatRouteNotice(held, LABELS).text).not.toContain('→')
  })
})

describe('formatRouteNotice — the collapsed row', () => {
  it('summarises the same transition, named, within the platform bound', () => {
    const { summary } = formatRouteNotice(input(), LABELS)
    expect(summary).toContain('shift-router')
    expect(summary).toContain('Fast → Smart')
    expect(summary.length).toBeLessThanOrEqual(CONTEXT_SUMMARY_MAX_CHARS)
  })

  it('stays within the bound even for pathologically long model ids', () => {
    const { summary } = formatRouteNotice(input({
      fromModel: 'x'.repeat(200),
      toModel: 'y'.repeat(200),
      fromProvider: 'p'.repeat(60),
      toProvider: 'q'.repeat(60),
    }), LABELS)
    expect(summary.length).toBeLessThanOrEqual(CONTEXT_SUMMARY_MAX_CHARS)
  })
})
