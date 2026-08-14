/**
 * Fake LLM adapter for the dsh-shift-router end-to-end test.
 *
 * Registers the `fake` provider route so the router's judge, model probe, and
 * the agent turn all stream through this adapter WITHOUT any real API key.
 * Judge calls (system prompt contains the Judge System Prompt) answer with a
 * `smart` verdict; ordinary turns answer with a reply that echoes the exact
 * model the request ran on, so the headless output proves which model the
 * router selected.
 */

import { LlmAdapter } from '@deepseek-ai/dsh-llm'

export const name = 'fake-adapter'
export const inject = ['llm']

const JUDGE_ANSWER = '{"tier":"smart","confidence":0.9,"reason":"e2e routing test"}'

class FakeAdapter extends LlmAdapter {
  stream(options) {
    const isJudge = (options.system ?? '').includes('Judge System Prompt')
    const text = isJudge
      ? JUDGE_ANSWER
      : `ROUTER-E2E: turn ran on ${options.provider}/${options.model}`
    return (async function* () {
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  }
}

export function apply(ctx) {
  ctx.llm.registerAdapter(['fake'], new FakeAdapter())
}
