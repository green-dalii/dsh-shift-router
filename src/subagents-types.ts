/**
 * Structural view of the Harness subagent service (`ctx.subagents`), used by
 * the orchestration delegate tool.
 *
 * The plugin does not import `@deepseek-ai/dsh-subagent` at runtime, and the
 * package is not a declared peer: the service is looked up through Cordis, and
 * this declaration is the type-only seam. It covers exactly the shapes the
 * delegate tool uses and nothing else.
 *
 * The service has two shipped signatures (SPEC §7.6):
 * - `0.2.1-rc.2`: `startActivation({ provider, label, request, signal, delivery })`
 *   with the task under `request.prompt` (`ContentBlock[]`) and the parent under
 *   `request.parent`.
 * - `0.2.1-rc.5`: `startActivation({ provider, label, prompt, parent, agentOptions, signal, delivery })`.
 * The helper in `delegate.ts` sends both shapes in one spec; each generation
 * reads the fields it knows and ignores the others.
 *
 * A child asset (`output`, `stopReason`) mirrors the documented
 * `SubagentResult`; the public promise settles with a stop reason instead of
 * rejecting for ordinary child failures.
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Child route override accepted by both service generations. */
export interface DelegateAgentOptions {
  provider?: string
  model?: string
}

/** Terminal child result, borrowed immutably. */
export interface DelegateResult {
  readonly output: readonly ContentBlock[]
  readonly stopReason: string
  readonly diagnostic?: string
  readonly structured?: unknown
}

/** One managed child activation. */
export interface DelegateActivation {
  readonly childId: SessionId
  readonly result: Promise<DelegateResult>
  dispose(): Promise<void>
}

/** The single service method this plugin uses. */
export interface DelegateSubagentService {
  startActivation(spec: DelegateActivationSpec): Promise<DelegateActivation>
}

/** Both shipped spec shapes in one object (see the module comment). */
export interface DelegateActivationSpec {
  provider: string
  label: string
  delivery: 'caller'
  signal: AbortSignal
  /** rc.5 shape. */
  prompt: string
  parent: Agent
  agentOptions?: DelegateAgentOptions
  /** rc.2 shape. */
  request: {
    prompt: readonly ContentBlock[]
    parent: Agent
    agentOptions?: DelegateAgentOptions
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    readonly subagents: DelegateSubagentService
  }
}
