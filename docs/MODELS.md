# Choosing models

The **runtime model catalog is the only source of truth for what a deployment can call**:
`ctx.remote.session.modelCatalog()` — the same catalog the `/model` selector and the settings
card's dropdowns read ([SPEC §12.2](../SPEC.md#122-where-the-model-lists-come-from-normative)).
This page is *guidance for choosing* among the models that catalog already offers. It can age,
which is why every table below carries its source and retrieval date.

Two consequences, before anything else:

- **Nothing here overrides your deployment.** A model this page names but your catalog does not
  advertise is a fact about this page, not about your deployment. The catalog wins.
- **Numbers move.** Read the prices and context windows below as the *shape* of a trade-off;
  read your provider's own catalog for what you will actually be billed.

## Availability comes from the runtime catalog

DSH resolves every configured provider through its adapters, and the catalog is the projection of
that. Two habits follow:

- **Read the catalog, do not infer it.** The GUI card's provider/model dropdowns and `/model` both
  render it ([SPEC §12.3](../SPEC.md#123-card-ux-rules-normative), [README §Commands](../README.md#commands)).
  What a tier can use is what the dropdown offers.
- **A provider row with no `models` list is not "no models".** Built-in providers are answered by
  the *installed* catalog, so a route can resolve models your own `settings.yaml` never lists —
  the explicit list is an override, not the inventory. This is also why the catalog is authoritative
  for availability rather than any hand-written table.

As a concrete, labelled example: one real deployment (this project's development machine) configures
four `llm-pi-ai` routes — `command-code` (71 explicit models over an OpenAI-completions endpoint),
`openrouter` (15 free models), `or` (1 free model) and `minimax-cn` (no explicit models). Treat that
as *one deployment's* shape, not a recommended list.

> Source: `llm-pi-ai.providers` in that deployment's `$DSH_HOME/settings.yaml`, read 2026-09-21; the
> "built-in providers answer from the installed catalog" rule is the official DSH provider guide
> (`docs/user/guide/providers.md`, fetched 2026-09-21).

## What makes a good Fast model

The Fast tier is the one that runs most turns, so it is judged on three things at once: **cheap,
quick, and good enough on routine edits** — bug fixes, small refactors, doc updates, running tests.
It is also the tier the Judge itself runs on, so its price and latency are paid on *every* turn
whether or not the turn stays on Fast ([SPEC §6.4](../SPEC.md#64-judge-model)).

Look for a small-context-cheap model with a large enough context window to hold your working set,
and prefer one that also accepts images if anyone on your team pastes screenshots.

| Model (as advertised by OpenRouter) | Context | Input modalities | Price / 1M tokens (in → out) |
|---|---|---|---|
| `qwen/qwen3.7-flash` | 1,000,000 | text, image, video | $0.03 → $0.13 |
| `z-ai/glm-5.3-flash` | 1,310,720 | text, image, video | $0.09 → $0.30 |
| `deepseek/deepseek-v4.1-flash` | 1,048,576 | text, image | $0.15 → $0.60 |
| `openai/gpt-5.6-luna` | 1,050,000 | text, image, file | $0.20 → $1.20 |

> Source: `https://openrouter.ai/api/v1/models`, retrieved 2026-09-21. Prices are that API's
> per-token fields multiplied by 10⁶; they are OpenRouter's, not your provider's.

**The Judge warning.** Because the Judge classifies on the Fast chain, an expensive Fast chain makes
every turn expensive — including turns that end up running Smart. A Fast tier priced like a flagship
turns the router into a cost *multiplier*. If you want a strong model available, put it in Smart.

## What makes a good Smart model

Smart is the escalation target: multi-step reasoning, large refactors, unfamiliar codebases, and the
turns where being wrong is expensive. Here depth and context length dominate, and price matters less
because the tier is used deliberately rather than constantly ([SPEC §3](../SPEC.md#3-ev-economics-normative)).

| Model (as advertised by OpenRouter) | Context | Input modalities | Price / 1M tokens (in → out) |
|---|---|---|---|
| `anthropic/claude-opus-5` | 1,000,000 | text, image, file | $5.00 → $25.00 |
| `openai/gpt-5.6-sol` | 1,050,000 | text, image, file | $2.00 → $10.00 |
| `moonshotai/kimi-k3` | 1,048,576 | text, image, video | $1.70 → $8.50 |
| `deepseek-official/deepseek-v4-pro` | 1,000,000 | text | *(your provider's)* |

> Sources: OpenRouter API as above (2026-09-21); the `deepseek-official` row is the DSH adapter's own
> `DEFAULT_MODELS` entry (`@deepseek-ai/dsh-llm-deepseek` 0.1.5-rc.2, `lib/index.js`), which declares
> the id, the 1 M context window and `text` — no image — for that model.

## One provider or two?

**Same provider for both tiers** keeps one prompt cache, one bill and one rate-limit pool in play.
DSH rewards this explicitly: when the tiers share a provider, `cacheAware.sameFamilyPenalty`
(default **1.5**) divides the decision bar, which *reduces* downgrades, and downgrades are suppressed
while the cache is still warm (`idleBoundaryMs`, default 5 min) — because crossing a model boundary
is a guaranteed cache miss, and a cheaper model can cost more overall
([SPEC §5](../SPEC.md#5-cache-aware-routing)).

**Different providers** is the better shape when no single vendor offers both a good cheap model and
a good frontier one, or when you want a fallback chain that cannot fail together. Cross-family
deployments are unaffected by the cache rules: the factor is 1 and the idle gate is skipped, so
switching costs whatever the models cost.

| If you… | Prefer | Because |
|---|---|---|
| already pay one vendor | same provider | warm cache, one quota, no cross-vendor key juggling |
| need best-of-breed per tier | two providers | each tier gets the strongest model available to you |
| are near a rate limit | two providers | two independent limit pools |
| route mostly short, cacheable turns | same provider | the cache discount compounds across turns |

> Source: SPEC §5 (normative, this repository), read 2026-09-21; the "one bill / one quota" column is
> planning guidance, not a DSH guarantee.

## Ordering a chain

Each tier is a list of `{provider, model, priority}`; **`priority` ascending is the fallback order**
([SPEC §10](../SPEC.md#10-configuration-reference)). At runtime a failing model is marked in cooldown
and the tier re-resolves to the next one, so the chain is what keeps a turn alive
([SPEC §8](../SPEC.md#8-runtime-failover)).

- **A fallback must differ from its primary** — a different model id, a different provider, or both.
  Repeating the same route makes the chain a no-op, and the card says so.
- **Keep chains short and meaningful.** Two or three entries you trust beat ten you have never
  exercised; every entry is also a promise that its provider is reachable.
- **Order by your own evidence.** If you have not watched a model fail, put it behind one you have.

> Source: SPEC §8 and §10 (normative, this repository), read 2026-09-21.

## Image input and declared modalities

Reading an image is not a matter of asking nicely: DSH checks the **resolved route's declared
modalities** before the tool runs. `read_image` refuses with

```
cannot read "<path>" as an image: model "<model>" does not declare image input;
switch to an image-capable model to read images
```

> Source: `@deepseek-ai/dsh-tool-fs` 0.1.5-rc.2, `lib/index.js` (`assertImageCapableRoute`), read
> 2026-09-21. The same gate exists in `dsh-acp` and `dsh-mcp-client`.

So a model that can genuinely accept images still fails until the *route* says it can:

- The declaration is per model, in the provider's config. pi-ai providers use **`input`**;
  the direct DeepSeek adapter uses **`inputModalities`** (official guide, 2026-09-21).
- An omitted or empty `input` inherits the installed catalog, then the route's `defaultInput`
  (default `[text]`). `defaultInput` is a **fallback, not an override** — it never removes image
  capability a catalog model already has. Built-in providers without an explicit `models` list take
  per-model overrides under `modelOverrides`, keyed by model id.
- The direct DeepSeek adapter treats an omitted `inputModalities` as **text-only**, and rejects an
  empty list.
- **The declaration is an assertion about your endpoint, not a check of it.** DSH will not catch a
  model you marked image-capable that the provider then refuses; the provider rejects the request.
  Mark only what you have verified.

Verified examples, and two traps:

| Family | Image-capable ids seen | Text-only ids seen |
|---|---|---|
| Anthropic | `claude-opus-5`, `claude-sonnet-5` | — |
| OpenAI | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | — |
| Google | `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash` | — |
| Qwen | `qwen3.8-max`, `qwen3.8-flash`, `qwen3.8-27b`, `qwen3.7-flash`, `qwen3.7-plus` | `qwen3.8-2.4t-a95b` |
| Z.ai (GLM) | `glm-5.3-flash`, `glm-5.3-flashx` | `glm-5.3` |
| Moonshot | `kimi-k3` | — |
| DeepSeek | `deepseek/deepseek-v4.1-flash`, `deepseek/deepseek-v4-flash-vision-exp`, `deepseek-flash` | `deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-flash`, `deepseek/deepseek-v4-pro-0813` |

> Source: `https://openrouter.ai/api/v1/models`, retrieved 2026-09-21 (per-model
> `architecture.input_modalities`); the `deepseek-*` (unqualified) ids and their modalities are the
> `deepseek-official` route's own `DEFAULT_MODELS` in `@deepseek-ai/dsh-llm-deepseek` 0.1.5-rc.2.
> `claude-sonnet-5`, `gpt-5.6-*`, `kimi-k3`, `MiniMax-M3`, `Qwen/Qwen3.8-*` and `xai/grok-4.6` were
> additionally confirmed as declared image models in one deployment's `settings.yaml` (2026-09-21) —
> an example, not an inventory.

**Do not assume a family.** `glm-5.3` is text-only while its `-flash` sibling takes images and video;
`qwen3.8-2.4t-a95b` is text-only while other 3.8 models are not; and on the `deepseek-official` route
the *newest-sounding* id (`deepseek-v4-pro`) is text-only while `deepseek-flash` is not.

## A worked two-tier configuration

Both surfaces write the same thing. Only `deepseek-official` ids appear here because that route's
model list is the DSH adapter's own (source below) — swap in ids your catalog actually advertises.

As a profile patch row (note that a patch row **replaces the whole `config` value**, so restate every
key you need — [SPEC §10](../SPEC.md#10-configuration-reference)):

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: shift-router
  config:
    tiers:
      fast:
        models:
          - { provider: deepseek-official, model: deepseek-v4-flash, priority: 1 }
          - { provider: deepseek-official, model: deepseek-flash, priority: 2 }   # image-capable
      smart:
        models:
          - { provider: deepseek-official, model: deepseek-v4-pro, priority: 1 }
```

The equivalent in the settings document (what the GUI card and `/router config` write):

```yaml
# $DSH_HOME/settings.yaml
shift-router:
  tiers:
    fast:
      models:
        - provider: deepseek-official
          model: deepseek-v4-flash
          priority: 1
        - provider: deepseek-official
          model: deepseek-flash
          priority: 2
    smart:
      models:
        - provider: deepseek-official
          model: deepseek-v4-pro
          priority: 1
```

Why this shape: the Fast primary is the cheap text model, the Fast fallback is the image-capable
sibling so screenshot work survives on Fast, and Smart escalates to the reasoning model. If your
Fast chain were instead a frontier model, every Judge call would bill at frontier prices — see
"What makes a good Fast model" above.

> Source: the four `deepseek-official` ids and their declared modalities are `DEFAULT_MODELS` in
> `@deepseek-ai/dsh-llm-deepseek` 0.1.5-rc.2 (`lib/index.js`), read 2026-09-21. Prices for that route
> come from your own provider/credentials and are deliberately not asserted here.

## Verifying a tier resolves

1. **The card.** Settings → Plugins → Plugin configuration → *Shift-Router*: the provider/model
   dropdowns are the runtime catalog, and the card calls out an empty tier, duplicated routes and an
   identical Fast/Smart primary ([SPEC §12.3](../SPEC.md#123-card-ux-rules-normative)).
2. **`/router status`** — the configured chains, the current tier and the last decision
   ([SPEC §11](../SPEC.md#11-commands)).
3. **A real turn.** A switch writes a `[shift-router] …` notice into the conversation; with
   `ux.routerLogVerbose` every judged turn reports, including one that holds position
   ([SPEC §13.1](../SPEC.md#131-route-notices-normative)). That is the only proof of which model
   actually ran.
4. **The composed row** — `dsh --profile <name> --dump-config` shows whether your patch row landed.

If a tier stays empty, the router holds position instead of guessing; an empty or inert chain is
visible in steps 1 and 2 rather than only in routing behaviour.

> Source: SPEC §11–§13.1 and [README §Install](../README.md#install), this repository, read 2026-09-21.

## Sources

Everything above is traceable to one of these, all fetched or read on **2026-09-21**:

| # | Source | What it establishes |
|---|---|---|
| 1 | `@deepseek-ai/dsh-llm-deepseek` 0.1.5-rc.2, `lib/index.js` (`DEFAULT_MODELS`, `DEFAULT_CONTEXT_WINDOW`) | the `deepseek-official` route's real ids, 1 M context window, declared modalities |
| 2 | one deployment's `$DSH_HOME/settings.yaml` (`llm-pi-ai.providers`) — an example, not an inventory | which ids one real deployment declares, their `contextWindow`, and which carry `input: [text, image]` |
| 3 | `https://openrouter.ai/api/v1/models` | cross-provider live catalog: ids, `context_length`, `architecture.input_modalities`, `pricing` |
| 4 | `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/user/guide/providers.md` (and `…providers.zh.md`) | DSH's own framing: built-in providers answer from the installed catalog; `input` vs `inputModalities`; inheritance and `defaultInput`; "assertion, not a check" |
| 5 | `@deepseek-ai/dsh-tool-fs` 0.1.5-rc.2, `lib/index.js` (`assertImageCapableRoute`) | the exact image-capability refusal and the route it resolves |
| 6 | this repository: [SPEC](../SPEC.md) §3, §5, §6.4, §8, §10, §11, §12.2, §12.3, §13.1 and [README](../README.md) | the router's own normative behaviour; linked rather than restated |

Deliberately **not** stated here, because no fetched source supports it: per-model prices for the
`deepseek-official` route, latency/throughput rankings, and any "best model" verdict. Check your own
catalog — that is what it is for.
