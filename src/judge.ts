/**
 * dsh-shift-router — Task classifier (Judge)
 *
 * Single-stage classification via LLM (uses the fast tier's model chain).
 * On failure: hold position (return "fast"), log a warning.
 * No heuristic rules, no regex for the *decision* — the LLM is the sole
 * classifier. Regex is used only to parse the LLM's JSON reply.
 *
 * DSH adaptation: the judge call goes through `ctx.llm.stream()` instead of
 * a hand-built fetch to pi's models-store/auth endpoints. Credentials,
 * adapters, JSON-mode enforcement, and provider retry are the harness's job.
 * The Judge walks the fast tier chain in priority order, skipping models in
 * cooldown, and marks failover-worthy failures into the shared cooldown map
 * (same policy as the turn path).
 */

import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import type { JudgeResult, Tier, ModelRef } from './types.js'
import { detectFailoverError } from './failover.js'

// ─── Judge system prompt ──────────────────────────────────────────

const FALLBACK_PROMPT =
  'You are a task classifier. Respond with ONLY a JSON object: ' +
  '{"tier": "fast"} or {"tier": "smart"}.'

export const JUDGE_PROMPT = `# Judge System Prompt

You are a task classifier for an AI coding assistant. Given a user's message,
classify it into one of two tiers — the **role that will drive the entire
turn**. A turn is one full agent run (thinking, tool calls, message content);
the tier you pick is the model that **does the work**, at that tier's
intelligence level. The Judge itself is a small one-shot call.

**Respond with ONLY this JSON object, no other text, no markdown fences:**

\`\`\`json
{"tier": "fast", "confidence": 0.95, "reason": "routine bug fix, path clear"}
\`\`\`

or

\`\`\`json
{"tier": "smart", "confidence": 0.85, "reason": "user asked for depth"}
\`\`\`

\`tier\`, \`confidence\`, \`reason\` must appear inside the JSON object with no extra prose. \`confidence\` ∈ [0, 1] — how clearly the signals point to that tier (high = clear, ~0.3 = mixed). \`reason\` is one ultra-short phrase (3–8 words) naming the deciding signal ("architecture direction", "high stakes"). \`reason\` is for humans/debugging; the router never reads it.

## What each tier means

**fast** (engineer mode) — **execution driver**. The cheap, fast, reliable
engineer runs the whole turn: writes code, runs tests, fixes bugs, follows
established patterns. The task follows known patterns and needs no deep
architectural decisions. "Make it work — the path is clear."

**smart** (CTO mode) — **judgment driver**. The strong model acts as CTO and
runs the whole turn at high intelligence: sets direction, corrects course,
reviews results, personally takes on hard problems — architecture, trade-offs,
multi-step planning, security review. The task needs trade-off evaluation,
decisions, or direction-setting **and then executing that work**. High-stakes
work does not get dropped. "Is this the right approach — and if so, do it now —
the path is not yet clear." The smart model is not a judge that hands off — it
is the model that actually does the important work.

## Classification signals — weigh all four

### 1. Task content

| Signal | Tier |
|--------|------|
| Architecture, design decisions, technology selection — sets direction | smart |
| Course correction: the approach is wrong, needs rethinking, or must be reversed | smart |
| Code review, design review, security audit, quality assessment where the review itself is the deliverable — findings set direction, uncover risks, or drive rework | smart |
| Pointing out a small, well-defined flaw (UX nit, style slip, minor bug) with a routine fix and a clear path | fast |
| Multi-step planning, ambiguous requirements, open-ended strategy | smart |
| Performance / correctness investigation with unknown cause | smart |
| Routine code: writing functions, fixing bugs, adding tests, well-defined tasks | fast |
| Reading, explaining, summarizing existing code | fast |
| Following an established pattern or design | fast |
| Small refactors, "make it work" | fast |

### 2. User's explicit intent about model quality

Overrides task content — the user knows what they need.

- Wants depth: "think carefully", "deeply", "thoroughly", "your best model",
  "use the smartest model", "最强大模型", "仔细想想", "深思熟虑", "请认真分析" → **smart**
- Wants speed/brevity: "just give me a quick answer", "fast response",
  "简短回答", "别想太多", "快速答复", "just code it" → **fast**
- No preference → fall back to signals 1, 3, 4

### 3. Stakes and reversibility

- Production code, security, money, data integrity, public API → smart
- Throwaway script, prototype, exploration, single-use snippet → fast
- Irreversible action (delete, deploy, push to main) → smart

### 4. Ambiguity

- Multiple valid approaches, unclear requirements, hidden constraints → smart
- Clear, single, well-defined solution path → fast

## Conflict resolution

Priority order when signals disagree (highest wins):

1. **User's explicit intent** (signal 2) — always wins
2. High stakes + irreversibility (signal 3)
3. Task content (signal 1)
4. Ambiguity (signal 4) — defaults to fast when well-defined

**On "review" tasks**: judge by what the turn does, not the word "review".
Review as deliverable → \`smart\`; quick observation with a routine fix → \`fast\`
(engineer drives the turn, fix included). Ask: judgment call, or is the path
clear once the observation is made? Security review stays \`smart\` regardless
of code size; explicit depth request (signal 2) still wins.

## Examples

The "Tier" column is the model that **drives the whole turn**.

| Request | Tier | Why |
|---------|------|-----|
| "Write a function to sort an array" | fast | Routine, low stakes |
| "Fix this typo in the README" | fast | Trivial, reversible |
| "Design the data model for our billing system" | smart | Architecture |
| "Should we use REST or GraphQL for this?" | smart | Trade-off |
| "Review this PR for security issues" | smart | High stakes |
| "The config menu has selectable separators — that breaks UX, remove them" | fast | Small flaw, clear fix path |
| "Review the auth flow and tell me where it's fragile" | smart | Review = deliverable |
| "Design and implement the auth flow end-to-end" | smart | Multi-step + implements |
| "用最强模型帮我设计微服务架构" | smart | Explicit: 最强模型 → depth |
| "Think very carefully about this edge case" | smart | Explicit: think carefully |
| "请仔细推敲这个边界条件的处理" | smart | Explicit: 仔细推敲 → depth |
| "Just give me a quick yes/no" | fast | Explicit: quick |
| "别想太多，给我写个能跑的版本就行" | fast | Explicit: 别想太多 → speed |
| "ok" / "thanks" / "continue" / "继续" | fast | Acknowledgment |
| "Deploy this to production" | smart | Irreversible + high stakes |
| "Plan the migration from v1 to v2" | smart | Multi-step, ambiguous |`

/** Budget enough tokens for reasoning + JSON answer (Config-tunable default). */
export const JUDGE_MAX_TOKENS = 4000

// ─── Judge reply parsing (pure, unit-tested) ──────────────────────

/**
 * Safe JSON.stringify that returns the literal string "undefined" when
 * given `undefined`.
 */
function jsonStr(v: unknown): string {
  return v === undefined ? 'undefined' : JSON.stringify(v)
}

export function extractTier(text: string): Tier | null {
  if (!text) return null
  const trimmed = text.trim()

  // 1. JSON parse: {"tier": "fast" | "smart"}
  const jsonMatch = trimmed.match(/\{[^{}]*"tier"\s*:\s*"(fast|smart)"[^{}]*\}/i)
  if (jsonMatch) return jsonMatch[1]!.toLowerCase() as Tier

  // 2. JSON-like with single quotes or unquoted
  const looseMatch = trimmed.match(/["']?tier["']?\s*[:=]\s*["']?(fast|smart)["']?/i)
  if (looseMatch) return looseMatch[1]!.toLowerCase() as Tier

  // 3. Bare keyword (first occurrence, word-bounded)
  const keywordMatch = trimmed.match(/\b(fast|smart)\b/i)
  if (keywordMatch) {
    const w = keywordMatch[1]!.toLowerCase()
    if (w === 'fast' || w === 'smart') return w as Tier
  }

  return null
}

/** Result of parsing a Judge response: tier + optional confidence (0-1). */
export interface ParsedJudgeResponse {
  tier: Tier
  confidence?: number
  /** Ultra-short classification reason (one phrase); absent when not emitted. */
  reason?: string
}

/** Parse a Judge answer string (JSON or loose) for tier + confidence + reason. */
export function parseJudgeAnswer(text: string): ParsedJudgeResponse | null {
  const tier = extractTier(text)
  if (!tier) return null
  const confidence = parseConfidenceFromText(text)
  const reason = parseReasonFromText(text)
  const out: ParsedJudgeResponse = { tier }
  if (confidence !== undefined) out.confidence = confidence
  if (reason !== undefined) out.reason = reason
  return out
}

/**
 * Extract the short classification reason from a Judge answer string.
 * Picks the JSON `reason`/`why` field value if present (a quoted string);
 * returns undefined when absent or unparseable. The routing algorithm never
 * reads this — it exists for verbose logs and `/router status` detail.
 */
function parseReasonFromText(text: string): string | undefined {
  const jsonMatch = text.match(/"\s*(?:reason|why)"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (jsonMatch) {
    const s = jsonMatch[1]!.replace(/\\n/g, ' ').replace(/\\"/g, '"').trim()
    return s.length > 0 ? s.slice(0, 120) : undefined
  }
  return undefined
}

/** Extract confidence (0-1) from a Judge answer string. Returns undefined when absent/invalid. */
export function parseConfidenceFromText(text: string): number | undefined {
  // Try JSON first: {"tier":"fast","confidence":0.85}
  const jsonMatch = text.match(/\{[\s\S]*"confidence"\s*:\s*([0-9]*\.?[0-9]+)[\s\S]*\}/)
  if (jsonMatch) {
    const n = Number(jsonMatch[1])
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n
    return undefined
  }
  // Loose: confidence: 0.85 or confidence=0.85
  const looseMatch = text.match(/["']?confidence["']?\s*[:=]\s*([0-9]*\.?[0-9]+)/i)
  if (looseMatch) {
    const n = Number(looseMatch[1])
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n
  }
  return undefined
}

// ─── Judge LLM call through ctx.llm ───────────────────────────────

/** Discriminated result of a single Judge model call. */
export type JudgeCallOutcome =
  | { ok: true; result: JudgeResult }
  | { ok: false; code: string | null }

/**
 * One judge attempt against one model route. `failureCode` derives a
 * failover signature (429/5xx/quota) from the adapter failure; non-failover
 * failures (network, timeout, auth, unparseable) leave it null and never
 * cool the model down.
 */
export interface JudgeStreamCall {
  (provider: string, model: string, prompt: string, signal: AbortSignal): Promise<JudgeCallOutcome>
}

/**
 * Default stream caller — drives `ctx.llm.stream()` and assembles the reply.
 * Exported for tests to substitute a fake.
 */
export async function defaultJudgeStreamCall(
  ctx: Pick<Context, 'llm'>,
  prompt: string,
  provider: string,
  model: string,
  signal: AbortSignal,
  maxTokens: number = JUDGE_MAX_TOKENS,
): Promise<JudgeCallOutcome> {
  const assembler = new BlockAssembler()
  let stream
  try {
    stream = ctx.llm.stream({
      provider,
      model,
      system: JUDGE_PROMPT,
      messages: [createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'user' },
      })],
      temperature: 0,
      maxTokens,
      signal,
    })
    for await (const chunk of stream) {
      assembler.push(chunk)
    }
  } catch (error) {
    // A thrown stream error (middleware / transport) is not a failover signature.
    return { ok: false, code: null }
  }

  const finish = assembler.finish
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    const failure: LlmFailure = finish.failure
    return { ok: false, code: failureCodeFromFailure(failure) }
  }

  const text = assembler.blocks()
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('')

  const answer = parseJudgeAnswer(text)
  if (!answer) return { ok: false, code: null } // 200-but-unparseable — do NOT cool down

  const result: JudgeResult = {
    tier: answer.tier,
    source: 'llm',
    ...(answer.confidence !== undefined ? { confidence: answer.confidence } : {}),
    ...(answer.reason !== undefined ? { reason: answer.reason } : {}),
  }
  return { ok: true, result }
}

/** Derive a failover signature from an adapter failure. */
export function failureCodeFromFailure(failure: LlmFailure): string | null {
  const det = detectFailoverError(failure)
  return det ? det.code : null
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Unified task classifier with fast-tier fallback.
 *
 * `chain` is the fast tier's model list (priority order). The Judge walks it:
 * each failed call (failover or not) tries the next model. `isCooldown`
 * skips models in cooldown; `onFailure` (if provided) is invoked with a
 * failover signature code on each failover-worthy failure so the caller can
 * mark it into the shared cooldown map. Network errors, timeouts, and
 * unparseable responses do NOT call `onFailure` — they are not failover
 * signatures.
 *
 * `externalSignal` (the owning turn's abort signal, when any) is fused with
 * the per-attempt timeout so an aborted turn cancels the judge promptly.
 *
 * Only when ALL fast-tier models fail do we hold position (fallback).
 */
export async function classify(
  prompt: string,
  chain: ModelRef[] | null | undefined,
  streamCall: JudgeStreamCall,
  timeout = 5000,
  isCooldown?: (provider: string, model: string) => boolean,
  onFailure?: (provider: string, model: string, code: string) => void,
  externalSignal?: AbortSignal,
): Promise<JudgeResult> {
  const list = chain ?? []
  const sorted = [...list].sort((a, b) => a.priority - b.priority)

  for (const ref of sorted) {
    if (isCooldown?.(ref.provider, ref.model)) continue

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    let outcome: JudgeCallOutcome
    try {
      const fused = externalSignal === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, externalSignal])
      outcome = await streamCall(ref.provider, ref.model, prompt, fused)
    } finally {
      clearTimeout(timer)
    }

    if (outcome.ok) return outcome.result
    // Failover-worthy failure (429/5xx/quota) → let caller cool the model.
    if (outcome.code && onFailure) {
      onFailure(ref.provider, ref.model, outcome.code)
    }
  }

  return { tier: 'fast', source: 'fallback' }
}

/** Keep the fallback prompt referenced (tree-shake guard). */
export function judgeFallbackPrompt(): string {
  return FALLBACK_PROMPT
}

/** Re-export jsonStr for tests. */
export { jsonStr }
