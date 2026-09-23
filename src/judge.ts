/**
 * dsh-shift-router — Task classifier (Judge)
 *
 * Single-stage classification via LLM (uses the fast tier's model chain).
 * No heuristic rules, no regex for the *decision* — the LLM is the sole
 * classifier. Regex is used only to parse the LLM's JSON reply and to detect
 * provider failure signatures.
 *
 * On failure the Judge reports `source: 'fallback'`, which the router treats
 * as rung 3 of the availability ladder: with no judge at all it stops routing
 * rather than deciding without evidence (SPEC §2 step 2, §6.3). The `tier`
 * value carried alongside a fallback is a type-compatible placeholder, never
 * evidence — treating an outage as a decisive `fast` verdict is what silently
 * downgraded Smart sessions upstream.
 *
 * DSH adaptation: a `chat` judge call goes through `ctx.llm.stream()` instead
 * of a hand-built fetch to pi's models-store/auth endpoints. Credentials,
 * adapters, JSON-mode enforcement, and provider retry are the harness's job.
 * The Judge walks the availability ladder in order, skipping models in
 * cooldown, and marks failover-worthy failures into the shared cooldown map
 * (same policy as the turn path).
 *
 * A `decision` judge call (SPEC §6.6) is the one exception, and deliberately
 * so: the LLM seam is chat-shaped (`LlmCallConfig` in, `StreamChunk` out) and a
 * decision request has no chat encoding, so routing it through the seam would
 * mean inventing a private one. The transport lives here instead, with the
 * credential still taken from the harness credential seam per call.
 */

import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import type {
  JudgeChainEntry,
  JudgeChainInput,
  JudgeMode,
  JudgeResult,
  ModelRef,
  ShiftRouterConfig,
  Tier,
} from './types.js'
import { detectFailoverError } from './failover.js'

// ─── Judge system prompt ──────────────────────────────────────────

export const JUDGE_PROMPT = `# Judge System Prompt

You are a task classifier for an AI coding assistant. Given a user's message,
classify it into one of two tiers — the **role that will drive the entire
turn**. A turn is one full agent run (thinking, tool calls, message content);
the tier you pick is the model that **does the work**, at that tier's
intelligence level. The Judge itself is a small one-shot call.

**Respond with ONLY this JSON object, no other text, no markdown fences:**

\`\`\`json
{"tier": "fast", "confidence": 0.95, "reason": "routine bug fix, path clear", "orchestrate": false}
\`\`\`

or

\`\`\`json
{"tier": "smart", "confidence": 0.85, "reason": "user asked for depth", "orchestrate": true}
\`\`\`

All four keys must appear inside the JSON object with no extra prose.

- \`tier\` — the role that drives the whole turn.
- \`confidence\` ∈ [0, 1] — how clearly the signals point to that tier
  (high = clear, ~0.3 = mixed).
- \`reason\` — one ultra-short phrase (3–8 words) naming the deciding signal
  ("architecture direction", "high stakes"). For humans/debugging; the router
  never reads it.
- \`orchestrate\` — boolean. \`true\` only when the task is large or
  decomposable enough that the Smart tier should **delegate implementation to
  subagents** instead of doing it all itself. \`false\` when one model should
  just do the work. Emit \`false\` whenever \`tier\` is \`fast\`.

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
| Document handling — read, check, update, format, translate, or keep several docs consistent — *unless* the work sets direction (a new design doc, a review that drives rework) | fast |
| Tedious bulk batches: mechanical renames, repetitive edits across many files, boilerplate | fast |

### 2. User's explicit intent about model quality

Overrides task content — the user knows what they need.

**An explicit instruction is a certainty, not a hedge.** If the user names a
tier, a gear preset, or orchestration ("use the smart tier", "使用 Smart 档",
"go eco", "plan this out with subagents"), obey it and report
\`confidence\` ≥ 0.9. Do not average it against the other signals or hedge
below 0.9 because the task also looks routine — being told what to do removes
the uncertainty the other signals exist to resolve. Evaluate this signal
**before** any torn-task or mixed-evidence reasoning.

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
| "Plan the migration from v1 to v2" | smart | Multi-step, ambiguous |
| "Update the dates in these five docs" | fast | Doc handling, no direction set |
| "Translate this README and keep the tables aligned" | fast | Bulk + doc handling |
| "使用 Smart 档来做这个" | smart | Explicit tier request → conf ≥ 0.9 |
| "Take the smart model and split this into subagent tasks" | smart | Explicit tier + delegation |`

/** Budget enough tokens for reasoning + JSON answer (Config-tunable default). */
export const JUDGE_MAX_TOKENS = 4000

// ─── Judge reply parsing (pure, unit-tested) ──────────────────────

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

/** Result of parsing a Judge response: the four contract keys, all optional but `tier`. */
export interface ParsedJudgeResponse {
  tier: Tier
  confidence?: number
  /** Ultra-short classification reason (one phrase); absent when not emitted. */
  reason?: string
  /**
   * The Judge's orchestration opinion. Absent (older prompt, or the model did
   * not emit it) means "no opinion" — the caller falls back to the tier-based
   * default, so an older prompt keeps working.
   */
  orchestrate?: boolean
}

/** Parse a Judge answer string (JSON or loose) for tier + confidence + reason + orchestrate. */
export function parseJudgeAnswer(text: string): ParsedJudgeResponse | null {
  const tier = extractTier(text)
  if (!tier) return null
  const confidence = parseConfidenceFromText(text)
  const reason = parseReasonFromText(text)
  const orchestrate = parseOrchestrateFromText(text)
  const out: ParsedJudgeResponse = { tier }
  if (confidence !== undefined) out.confidence = confidence
  if (reason !== undefined) out.reason = reason
  if (orchestrate !== undefined) out.orchestrate = orchestrate
  return out
}

/**
 * Extract the Judge's orchestration opinion from its answer. Accepts the
 * documented `orchestrate` key plus a couple of tolerant aliases; returns
 * undefined when the model said nothing about it (which must keep working as
 * "no opinion", not as `false`).
 */
export function parseOrchestrateFromText(text: string): boolean | undefined {
  const match = text.match(
    /["']?(?:orchestrate|delegate|subagents?)["']?\s*[:=]\s*["']?(true|false|yes|no)["']?/i,
  )
  if (!match) return undefined
  const value = match[1]!.toLowerCase()
  return value === 'true' || value === 'yes'
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
/** Raw text outcome of one model attempt: the assembled reply, or a failure. */
export type StreamTextOutcome =
  | { ok: true; text: string }
  | { ok: false; code: string | null }

/**
 * Drive `ctx.llm.stream()` once and assemble the reply text.
 *
 * Shared by the Judge and the acceptance auditor (C1): the assembly rules and
 * the failover-signature derivation are subtle enough that two copies would
 * drift, and the auditor must fail over exactly like the Judge does.
 *
 * @param ctx - anything exposing the llm service.
 * @param system - system prompt for this call.
 * @param prompt - user-turn text.
 * @param provider - route provider.
 * @param model - route model.
 * @param signal - cancellation (the caller fuses its timeout in).
 * @param maxTokens - output cap.
 * @returns the assembled text, or a failure with a failover code when derivable.
 */
export async function streamAssistantText(
  ctx: Pick<Context, 'llm'>,
  system: string,
  prompt: string,
  provider: string,
  model: string,
  signal: AbortSignal,
  maxTokens: number,
): Promise<StreamTextOutcome> {
  const assembler = new BlockAssembler()
  let stream
  try {
    stream = ctx.llm.stream({
      provider,
      model,
      system,
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
  return { ok: true, text }
}

export async function defaultJudgeStreamCall(
  ctx: Pick<Context, 'llm'>,
  prompt: string,
  provider: string,
  model: string,
  signal: AbortSignal,
  maxTokens: number = JUDGE_MAX_TOKENS,
): Promise<JudgeCallOutcome> {
  const outcome = await streamAssistantText(ctx, JUDGE_PROMPT, prompt, provider, model, signal, maxTokens)
  if (!outcome.ok) return { ok: false, code: outcome.code }
  const text = outcome.text

  const answer = parseJudgeAnswer(text)
  if (!answer) return { ok: false, code: null } // 200-but-unparseable — do NOT cool down

  const result: JudgeResult = {
    tier: answer.tier,
    source: 'llm',
    ...(answer.confidence !== undefined ? { confidence: answer.confidence } : {}),
    ...(answer.reason !== undefined ? { reason: answer.reason } : {}),
    ...(answer.orchestrate !== undefined ? { orchestrate: answer.orchestrate } : {}),
  }
  return { ok: true, result }
}

/** Derive a failover signature from an adapter failure. */
export function failureCodeFromFailure(failure: LlmFailure): string | null {
  const det = detectFailoverError(failure)
  return det ? det.code : null
}

// ─── Judge source and availability ladder (SPEC §6.3, §6.4) ───────

/**
 * A decision call is floored at this, measured rather than assumed: live runs
 * against the TypeSafe decision endpoint returned in **1.4–6.6 s**, dominated
 * by service-side inference and not by payload size (upstream measured 8 calls
 * at 458–2265 input tokens, 2026-09-18). The LLM judge's 5 s default would
 * abort most decision calls, and an aborted judge releases the turn (SPEC
 * §6.3) — the feature would be present and unusable.
 */
export const DECISION_MIN_JUDGE_TIMEOUT_MS = 15_000

/**
 * Bookkeeping label for the decision endpoint's "provider" slot.
 *
 * A decision endpoint is configured by URL, not by a harness provider route, so
 * it has no route key of its own; the ladder still needs one for dedup and for
 * cooldown keying. This is a label in our own namespace, never a provider name
 * a deployment could collide with.
 */
export const DECISION_PROVIDER_LABEL = 'decision'

/**
 * The Judge's effective source mode from whatever shape the config is in
 * (SPEC §6.4's migration contract):
 *
 * - a known mode is honoured as-is;
 * - `models` present with **no** mode is `custom` — the migration case, where
 *   the merged default (`fast-chain`) would silently discard the list, so
 *   inferring `custom` is the only reading that keeps the user's intent;
 * - anything else (absent, unknown, an empty list) is `fast-chain`, so a typo
 *   or a hand-edit degrades to what every old config already did instead of
 *   bricking routing.
 */
export function normalizeJudgeMode(judge?: { mode?: string; models?: readonly unknown[] }): JudgeMode {
  const raw = judge?.mode
  if (raw === 'fast-chain' || raw === 'custom' || raw === 'decision') return raw
  if (raw === undefined && (judge?.models?.length ?? 0) > 0) return 'custom'
  return 'fast-chain'
}

/** `priority` ascending, stable — the configured order is a fallback order. */
function byPriority(a: ModelRef, b: ModelRef): number {
  return a.priority - b.priority
}

/** Whether an unknown `mode` was reported as `fast-chain` by the normalizer. */
export function judgeModeWasNormalized(judge?: { mode?: string }): boolean {
  const raw = judge?.mode
  return raw !== undefined && normalizeJudgeMode(judge) !== raw
}

/**
 * The Judge's availability ladder (SPEC §6.3), as one ordered list.
 *
 * Rung 1 is the configured source (`custom`'s chain, or the `decision`
 * endpoint) and rung 2 is the Fast chain. Concatenating them means a single
 * `classify()` walk covers *both* ways rung 1 can fail — unresolvable, or
 * failing at call time (429, 5xx, timeout, cooldown) — instead of losing the
 * turn's routing to a transient error while a working judge is one rung away.
 *
 * `priority` orders entries *within* a rung; the rung order is authoritative.
 * Rung 1 resolves only what the user configured: substituting a cheaper model
 * would judge the turn with something they did not choose.
 */
export function judgeChainFor(config: ShiftRouterConfig): JudgeChainEntry[] {
  const fast: JudgeChainEntry[] = [...(config.tiers.fast?.models ?? [])]
    .sort(byPriority)
    .map((ref) => ({ ...ref, kind: 'chat' as const }))

  const mode = normalizeJudgeMode(config.routing?.judge)
  let configured: JudgeChainEntry[] = []
  if (mode === 'custom') {
    configured = [...(config.routing.judge?.models ?? [])]
      .sort(byPriority)
      .map((ref) => ({ ...ref, kind: 'chat' as const }))
  } else if (mode === 'decision') {
    const baseUrl = config.routing.judge?.decision?.baseUrl?.trim() ?? ''
    if (baseUrl) {
      const model = config.routing.judge?.decision?.model?.trim() || 'jev-latest'
      configured = [{ provider: DECISION_PROVIDER_LABEL, model, priority: 1, kind: 'decision' }]
    }
  }

  const seen = new Set<string>()
  const ladder: JudgeChainEntry[] = []
  for (const entry of [...configured, ...fast]) {
    const key = `${entry.provider}/${entry.model}`
    if (seen.has(key)) continue
    seen.add(key)
    ladder.push(entry)
  }
  return ladder
}

/**
 * The per-attempt timeout for one ladder entry. A decision call carries the
 * measured floor; a chat call is left exactly as configured.
 */
export function judgeTimeoutFor(kind: 'chat' | 'decision', configured: number): number {
  return kind === 'decision' ? Math.max(configured, DECISION_MIN_JUDGE_TIMEOUT_MS) : configured
}

// ─── Decision protocol (SPEC §6.6) ────────────────────────────────

/** The decision endpoint's path, appended to `routing.judge.decision.baseUrl`. */
const DECISION_API_PATH = '/v1/systemone'

/**
 * Fixed orchestration criteria. Like `JUDGE_PROMPT` these are the *rubric*, not
 * a deployment parameter: which turns deserve orchestration is our opinion, and
 * a deployment that disagrees edits the tier choices, not this sentence.
 */
const DECISION_ORCHESTRATE_INSTRUCTIONS =
  'This turn should be orchestrated (a Smart main agent planning phases and delegating ' +
  'to Fast workers) rather than handled inline by a single agent.'

/** The tier rubric sent to a decision model, keyed by the answer it may give. */
const DECISION_TIER_CRITERIA = {
  fast: 'Routine, well-specified work: execution, small fixes, following existing patterns.',
  smart: 'Complex, ambiguous, high-stakes, cross-cutting, or architecture-level work.',
} as const

const DECISION_ORCHESTRATE_CRITERIA = {
  true: 'Multi-phase work that benefits from delegation to workers.',
  false: 'Single-agent work; inline execution is appropriate.',
} as const

/** `<baseUrl>/v1/systemone`, tolerant of a trailing slash in configuration. */
export function judgeApiUrl(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}${DECISION_API_PATH}`
}

/**
 * The request body: one `choice` question for the tier and one `noul` (numeric,
 * yes/no) question for orchestration, both in the single POST that is one
 * judgement. Shape frozen from upstream's `buildDecisionRequestBody()`.
 */
export function buildDecisionRequestBody(model: string, prompt: string): Record<string, unknown> {
  return {
    model,
    state: prompt,
    questions: {
      tier: { type: 'choice', instructions: JUDGE_PROMPT, criteria: DECISION_TIER_CRITERIA },
      orchestrate: {
        type: 'noul',
        instructions: DECISION_ORCHESTRATE_INSTRUCTIONS,
        criteria: DECISION_ORCHESTRATE_CRITERIA,
      },
    },
  }
}

/** Answers ride in an `answers` envelope or as a bare map; both are accepted. */
function decisionAnswers(raw: unknown): Record<string, unknown> | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const record = raw as Record<string, unknown>
  const wrapped = record.answers
  if (wrapped !== null && typeof wrapped === 'object') return wrapped as Record<string, unknown>
  return record
}

/** The model version that answered, when the endpoint reports one. */
export function resolvedModelOf(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const model = (raw as Record<string, unknown>).model
  return typeof model === 'string' && model.length > 0 ? model : undefined
}

/**
 * Map a decision response onto the Judge's parse contract.
 *
 * Returns null — which the caller treats as a failed attempt, so the ladder
 * keeps walking — whenever no usable tier answer is present. A decision model
 * must never be guessed at, and an out-of-set choice is not a verdict.
 *
 * `confidence` is `probabilities[choice]`, i.e. the probability of the tier the
 * model actually chose, so `pSmartOf()` (SPEC §3) reads the same evidence and
 * needs no re-scaling.
 */
export function parseDecisionResponse(raw: unknown): ParsedJudgeResponse | null {
  try {
    const answers = decisionAnswers(raw)
    const tierAnswer = answers?.tier
    if (tierAnswer === null || typeof tierAnswer !== 'object') return null
    const tier = tierAnswer as Record<string, unknown>

    const choice = typeof tier.choice === 'string' ? tier.choice.toLowerCase() : null
    if (choice !== 'fast' && choice !== 'smart') return null

    const probabilities = tier.probabilities
    const probability = probabilities !== null && typeof probabilities === 'object'
      ? (probabilities as Record<string, unknown>)[choice]
      : undefined
    const confidence = typeof probability === 'number'
      ? probability
      : typeof tier.confidence === 'number'
        ? tier.confidence
        : undefined

    const noulRaw = answers?.orchestrate
    const noul = typeof noulRaw === 'number'
      ? noulRaw
      : noulRaw !== null && typeof noulRaw === 'object'
        ? (noulRaw as Record<string, unknown>).noul
        : undefined
    const orchestrate = typeof noul === 'number' ? noul >= 0.5 : undefined

    return {
      tier: choice,
      ...(confidence !== undefined ? { confidence } : {}),
      ...(orchestrate !== undefined ? { orchestrate } : {}),
    }
  } catch {
    return null
  }
}

/**
 * Derive a failover signature from a decision endpoint's HTTP status, in the
 * same vocabulary the harness failures use: 429 and 402 are the two codes the
 * router's cooldown ladder and its "insufficient balance" handling recognise,
 * and 5xx is the server-error family. Anything else (notably 401/403 — a
 * configuration mistake, not a transient outage) cools nothing, exactly as a
 * chat attempt's auth failure does not.
 */
export function decisionFailureCode(status: number): string | null {
  if (status === 429) return '429'
  if (status === 402) return '402'
  if (status >= 500 && status < 600) return String(status)
  return null
}

/** One decision-model attempt against one ladder entry. */
export interface DecisionCall {
  (entry: JudgeChainEntry, prompt: string, signal: AbortSignal): Promise<JudgeCallOutcome>
}

/**
 * What a decision call needs from its deployment. `baseUrl` and `apiKeyRef` are
 * configuration; `resolveKey` is the harness credential seam, injected so the
 * transport stays testable and so the plugin holds no second credential path.
 */
export interface DecisionCallDeps {
  baseUrl: string
  apiKeyRef: string
  /**
   * Resolve a credential reference to its value. Absent when the deployment
   * mounts no credentials provider — the endpoint then cannot authenticate, so
   * the call fails and the ladder uses rung 2 rather than the plugin failing to
   * load.
   */
  resolveKey?: (ref: string) => Promise<string | undefined>
  fetchImpl?: typeof fetch
  log?: (message: string) => void
}

/**
 * Build the decision transport for one configured endpoint.
 *
 * Deliberately a direct POST rather than a harness LLM-seam call: the seam is
 * chat-shaped, so carrying a decision request through it would mean inventing a
 * private encoding (ALIGNMENT §R12.1). Credentials still come from the seam.
 */
export function createDecisionCall(deps: DecisionCallDeps): DecisionCall {
  const url = judgeApiUrl(deps.baseUrl)
  const fetchImpl = deps.fetchImpl ?? fetch

  return async (entry, prompt, signal) => {
    let key: string | undefined
    if (deps.apiKeyRef) {
      try {
        key = await deps.resolveKey?.(deps.apiKeyRef)
      } catch (error) {
        // The reference is user-typed text and the seam rejects names outside
        // its grammar, so a throw here is a configuration mistake, not an
        // outage — and it must not escape into the turn.
        deps.log?.(
          `judge decision: credential "${deps.apiKeyRef}" could not be resolved — ` +
            (error instanceof Error ? error.message : String(error)),
        )
        return { ok: false, code: null }
      }
      if (key === undefined) {
        // Configured but unavailable: a structural failure, never a cooldown —
        // the same model will be just as unavailable next turn.
        deps.log?.(`judge decision: credential "${deps.apiKeyRef}" is not configured`)
        return { ok: false, code: null }
      }
    }

    let response: Response
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(key === undefined ? {} : { 'x-api-key': key }),
        },
        body: JSON.stringify(buildDecisionRequestBody(entry.model, prompt)),
        signal,
      })
    } catch (error) {
      // A network error or an abort (the caller's timeout, or the turn's own
      // signal) is not a failover signature.
      deps.log?.(`judge decision: request failed — ${error instanceof Error ? error.message : String(error)}`)
      return { ok: false, code: null }
    }

    if (!response.ok) {
      return { ok: false, code: decisionFailureCode(response.status) }
    }

    let raw: unknown
    try {
      raw = await response.json()
    } catch {
      return { ok: false, code: null }
    }

    const answer = parseDecisionResponse(raw)
    if (!answer) return { ok: false, code: null }

    const resolvedModel = resolvedModelOf(raw)
    const result: JudgeResult = {
      tier: answer.tier,
      source: 'llm',
      ...(answer.confidence !== undefined ? { confidence: answer.confidence } : {}),
      ...(answer.orchestrate !== undefined ? { orchestrate: answer.orchestrate } : {}),
      ...(resolvedModel !== undefined ? { resolvedModel } : {}),
    }
    return { ok: true, result }
  }
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * The two callers `classify()` dispatches to. Both are injected so tests can
 * substitute fakes; index.ts wires the real ones (the harness stream for
 * `chat`, the decision transport for `decision`).
 */
export interface JudgeCalls {
  chat: JudgeStreamCall
  decision: DecisionCall
}

/**
 * Unified task classifier over the Judge's availability ladder (SPEC §6.3).
 *
 * `chain` is the ladder (see `judgeChainFor`) **in walk order** — the order is
 * authoritative, because a configured judge is rung 1 whatever its `priority`
 * says. Each failed attempt (failover or not) tries the next entry, so an
 * unusable or transiently failing rung 1 falls through to the Fast chain in the
 * same turn instead of costing the turn its routing.
 *
 * `isCooldown` skips entries in cooldown; `onFailure` (if provided) is invoked
 * with a failover signature code on each failover-worthy failure so the caller
 * can mark it into the shared cooldown map. Network errors, timeouts, and
 * unparseable responses do NOT call `onFailure` — they are not failover
 * signatures.
 *
 * `externalSignal` (the owning turn's abort signal, when any) is fused with
 * the per-attempt timeout so an aborted turn cancels the judge promptly. A
 * decision attempt's timeout carries the measured floor (§6.6).
 *
 * When EVERY entry fails the result is `source: 'fallback'` — rung 3, which the
 * router treats as a RELEASE, not a hold (SPEC §2 step 2). The `tier` field in
 * that case is a type-compatible placeholder and must never be read as a
 * verdict — the caller checks `source`.
 */
export async function classify(
  prompt: string,
  chain: readonly JudgeChainInput[] | null | undefined,
  calls: JudgeCalls,
  timeout = 5000,
  isCooldown?: (provider: string, model: string) => boolean,
  onFailure?: (provider: string, model: string, code: string) => void,
  externalSignal?: AbortSignal,
): Promise<JudgeResult> {
  for (const entry of chain ?? []) {
    if (isCooldown?.(entry.provider, entry.model)) continue

    const kind = entry.kind ?? 'chat'
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), judgeTimeoutFor(kind, timeout))
    let outcome: JudgeCallOutcome
    try {
      const fused = externalSignal === undefined
        ? controller.signal
        : AbortSignal.any([controller.signal, externalSignal])
      outcome = kind === 'decision'
        ? await calls.decision(entry as JudgeChainEntry, prompt, fused)
        : await calls.chat(entry.provider, entry.model, prompt, fused)
    } finally {
      clearTimeout(timer)
    }

    if (outcome.ok) return outcome.result
    // Failover-worthy failure (429/5xx/quota) → let caller cool the model.
    if (outcome.code && onFailure) {
      onFailure(entry.provider, entry.model, outcome.code)
    }
  }

  return { tier: 'fast', source: 'fallback' }
}
