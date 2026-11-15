/**
 * dsh-shift-router — blocking worker delegation for task-level orchestration
 *
 * The Harness `subagent` tool starts an asynchronous activation and returns
 * `started subagent <name>` immediately; the child's real result arrives later
 * as a `subagent-settled` message. An orchestration loop that must review the
 * worker before it can continue therefore cannot use that tool: it would count
 * a launch receipt as a completed worker (the same defect upstream fixed in
 * pi-shift-router v1.9.0, SPEC §7.6).
 *
 * This module talks to the lower-level `ctx.subagents` service instead. The
 * service returns an activation whose `result` promise settles after the child
 * reaches quiescence, so one tool call can wait for the real output while the
 * orchestration turn stays single-turn (SPEC §7.3).
 *
 * Two shipped service shapes are supported without importing the package:
 * - `0.2.1-rc.2` reads `request.prompt` / `request.parent` / `request.agentOptions`;
 * - `0.2.1-rc.5` reads the top-level `prompt` / `parent` / `agentOptions`.
 * One spec carries both; each generation ignores the fields it does not know.
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {
  DelegateActivation,
  DelegateActivationSpec,
  DelegateAgentOptions,
  DelegateResult,
  DelegateSubagentService,
} from './subagents-types.js'

/** Model-facing tool name. `subagent` is the Harness's own asynchronous tool. */
export const DELEGATE_TOOL = 'delegate'

/** Short label retained in the child's catalog membership. */
export const DELEGATE_LABEL = 'worker'

/** Cooperative tool-call budget: a worker that never settles cannot hold a turn forever. */
export const DELEGATE_TIMEOUT_MS = 30 * 60_000

/** Tool description shown to the model. */
export const DELEGATE_DESCRIPTION =
  'Delegate one self-contained task to a fresh worker session and wait for its final result. '
  + 'Use this instead of `subagent` while orchestrating: it returns the worker\'s real output and '
  + 'the router counts it against the orchestration budget. Available only to the orchestrating '
  + 'top-level agent.'

/** JSON schema for the one argument. */
export const DELEGATE_PARAMETERS = {
  type: 'object',
  properties: {
    prompt: {
      type: 'string',
      description:
        'A self-contained task contract: goal, constraints, acceptance criteria and out-of-scope. '
        + 'The worker runs in a fresh session and inherits no conversation history.',
    },
  },
  required: ['prompt'],
  additionalProperties: false,
} as const

/**
 * Build the dual-shape activation spec.
 *
 * `prompt` is sent as a plain string for rc.5 and as one text block for rc.2,
 * because the older request field is `ContentBlock[]`.
 */
export function buildDelegateSpec(input: {
  parent: Agent
  prompt: string
  signal: AbortSignal
  agentOptions?: DelegateAgentOptions
}): DelegateActivationSpec {
  const { parent, prompt, signal, agentOptions } = input
  return {
    provider: 'spawn',
    label: DELEGATE_LABEL,
    delivery: 'caller',
    signal,
    prompt,
    parent,
    ...(agentOptions !== undefined ? { agentOptions } : {}),
    request: {
      prompt: [{ type: 'text', text: prompt }],
      parent,
      ...(agentOptions !== undefined ? { agentOptions } : {}),
    },
  }
}

/** Concatenate the child's text output, preserving block order. */
export function delegateResultText(result: DelegateResult): string {
  const text = result.output
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
  return text.length > 0 ? text : 'The worker finished without a closing message.'
}

/**
 * Whether a settled child counts as success.
 *
 * The service resolves ordinary child failures with a stop reason instead of
 * rejecting, so the caller maps this to the tool result's error flag.
 */
export function delegateSucceeded(result: DelegateResult): boolean {
  return result.stopReason === 'completed'
}

/** Whether a `delegate` tool result is a denial/validation error, not a worker outcome. */
export function isDelegateRejection(text: string): boolean {
  const trimmed = text.trim()
  return trimmed.startsWith('dsh-shift-router:') || trimmed.startsWith('delegate: ')
}

/** One-line reason for a failed child, for the tool error and the failure streak. */
export function delegateFailureMessage(result: DelegateResult): string {
  const diagnostic = result.diagnostic?.trim()
  const detail = diagnostic !== undefined && diagnostic.length > 0 ? `: ${diagnostic}` : ''
  return `Worker ended with stop reason "${result.stopReason}"${detail}`
}

/**
 * Start one child through whichever service generation is mounted.
 *
 * A service without `startActivation` is a composition error the caller
 * reports as a normal tool failure; this function only guards the shape.
 */
export async function startDelegate(
  service: DelegateSubagentService,
  input: Parameters<typeof buildDelegateSpec>[0],
): Promise<DelegateActivation> {
  if (typeof service.startActivation !== 'function') {
    throw new Error('the Harness subagent service does not expose startActivation')
  }
  return service.startActivation(buildDelegateSpec(input))
}
