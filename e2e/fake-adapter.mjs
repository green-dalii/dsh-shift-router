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
  /**
   * `prepareCall` is the adapter contract the running harness dispatches
   * through. This fixture imports `LlmAdapter` from THIS package's dependency
   * tree, which may be older than the harness that loads it, so declare the
   * default shape explicitly instead of relying on the base class providing it
   * (a base class from 0.1.0-rc.6 does not, and the harness then fails with
   * "registration.adapter.prepareCall is not a function").
   */
  async prepareCall(provider, model, signal) {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: (options) => this.stream(options),
    }
  }

  /**
   * The advisory catalog the GUI card and the `/model` selector read. Without
   * it a deployment advertises no models at all, which is exactly the state that
   * leaves a provider's dropdown empty — so the fixture must have one for the
   * e2e to prove the card's source answers.
   */
  async listModels(provider) {
    return [
      { provider, id: 'fake-fast', name: 'Fake Fast' },
      { provider, id: 'fake-smart', name: 'Fake Smart' },
    ]
  }

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
