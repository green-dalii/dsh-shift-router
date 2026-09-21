# 模型选型

**判定「这个部署实际能调哪些模型」的唯一事实来源是运行时模型目录**：
`ctx.remote.session.modelCatalog()` —— 与 `/model` 选择器、设置卡片下拉框同源
（[SPEC §12.2](../SPEC.md#122-where-the-model-lists-come-from-normative)）。本页只讲**怎么选**，
选的是目录里已经有的模型。内容会过时，所以下面每张表都带来源与抓取日期。

一条前提，先放在最前面：**本页不覆盖你的部署。** 本页点名的模型若不在你的目录里，那是本页的问题，
不是你的部署的问题；以目录为准。

## 可用性来自运行时目录

DSH 通过适配器解析每一个已配置的 Provider，目录就是这次解析的投影。由此有两个习惯：

- **读目录，不要猜。** GUI 卡片的 provider/model 下拉与 `/model` 渲染的都是它
  （[SPEC §12.3](../SPEC.md#123-card-ux-rules-normative)、[README §命令](../README.md#commands)）——
  某一档能用什么，就等于下拉框给什么。
- **Provider 里没写 `models` ≠ 没有模型。** 内置 Provider 由**已安装目录**作答，因此某条路由可以
  解析出你 `settings.yaml` 里从未列过的模型 —— 显式列表是**覆盖**，不是清单。这也是「可用性以
  目录为准」而不是以任何手写表为准的原因。

一个明确标注的例子：本项目开发机有四条 `llm-pi-ai` 路由 —— `command-code`（71 个显式模型）、
`openrouter`（15 个免费）、`or`（1 个免费）、`minimax-cn`（未写）。这是**某一个部署**的形态，
不是推荐清单。

> 来源：该部署 `$DSH_HOME/settings.yaml` 的 `llm-pi-ai.providers`，读取于 2026-09-21；
> 「内置 Provider 由已安装目录作答」这条规则来自官方 DSH Provider 指南
> （`docs/user/guide/providers.zh.md`，抓取于 2026-09-21）。

## 什么样的模型适合做 Fast

Fast 档承担大多数轮次，因此要同时满足三件事：**便宜、快、在日常编辑上够好**（修 bug、小重构、
改文档、跑测试）。它也是**裁判**所在的档位，所以它的价格与延迟是**每一轮**都要付的，无论这一轮最后
是否留在 Fast（[SPEC §6.4](../SPEC.md#64-judge-model)）。选型上找便宜、但上下文窗口装得下你的工作
集的模型；如果团队会贴截图，优先选同时接受图片的。

| 模型（OpenRouter 广告的 id） | 上下文 | 输入模态 | 价格 / 百万 token（入 → 出） |
|---|---|---|---|
| `qwen/qwen3.7-flash` | 1,000,000 | text、image、video | $0.03 → $0.13 |
| `z-ai/glm-5.3-flash` | 1,310,720 | text、image、video | $0.09 → $0.30 |
| `deepseek/deepseek-v4.1-flash` | 1,048,576 | text、image | $0.15 → $0.60 |
| `openai/gpt-5.6-luna` | 1,050,000 | text、image、file | $0.20 → $1.20 |

> 来源：`https://openrouter.ai/api/v1/models`，抓取于 2026-09-21。价格是该 API 的 per-token 字段
> 乘以 10⁶；它们是 OpenRouter 的价格，不是你的 Provider 的价格。

**裁判警告。** 因为裁判跑在 Fast 链上，**昂贵的 Fast 链会让每一轮都昂贵** —— 包括最终跑到 Smart 的
轮次。把 Fast 档定价成旗舰档，等于把路由器变成成本**放大器**；想要强模型，请放进 Smart。

## 什么样的模型适合做 Smart

Smart 是升级目标：多步推理、大重构、陌生代码库，以及「判断错了代价很高」的轮次。这里深度与上下文
长度优先，价格反而次要，因为这一档是被刻意使用的（[SPEC §3](../SPEC.md#3-ev-economics-normative)）。

| 模型（OpenRouter 广告的 id） | 上下文 | 输入模态 | 价格 / 百万 token（入 → 出） |
|---|---|---|---|
| `anthropic/claude-opus-5` | 1,000,000 | text、image、file | $5.00 → $25.00 |
| `openai/gpt-5.6-sol` | 1,050,000 | text、image、file | $2.00 → $10.00 |
| `moonshotai/kimi-k3` | 1,048,576 | text、image、video | $1.70 → $8.50 |
| `deepseek-official/deepseek-v4-pro` | 1,000,000 | text | *（按你的 Provider）* |

> 来源：`https://openrouter.ai/api/v1/models`，抓取于 2026-09-21；`deepseek-official` 那一行来自 DSH 适配器自己的
> `DEFAULT_MODELS`（`@deepseek-ai/dsh-llm-deepseek` 0.1.5-rc.2，`lib/index.js`），它为该模型声明了
> id、1 M 上下文窗口，以及 `text`（**不含** image）。

## 两个档用一个 Provider 还是两个？

**两档同一个 Provider** 意味着共用一份 prompt 缓存、一份账单、一个限流池。DSH 对此有明确奖励：
当两档共享 Provider 时，`cacheAware.sameFamilyPenalty`（默认 **1.5**）会**除**决策门槛，从而
**减少**降级次数；并且在缓存仍热时抑制降级（`idleBoundaryMs`，默认 5 分钟）—— 因为跨模型边界必然
缓存未命中，更便宜的模型反而可能更贵（[SPEC §5](../SPEC.md#5-cache-aware-routing)）。

**两个 Provider** 更适合这些情况：没有任何一家同时提供好的便宜模型与好的旗舰模型，或者你希望回退链
不会一起挂掉。跨家族部署不受缓存规则影响：系数为 1、热缓存门禁被跳过，切换成本就等于两个模型本身的
成本差。

| 如果你…… | 倾向 | 原因 |
|---|---|---|
| 已经在给某一家付费 | 同一个 Provider | 缓存热、额度一份、不必跨厂商管 key |
| 每一档都要最强 | 两个 Provider | 每档都能拿到你手上最强的模型 |
| 接近限流上限 | 两个 Provider | 两个互相独立的限流池 |

> 来源：SPEC §5（本仓库规范），读取于 2026-09-21；「一份账单 / 一份额度」那一列是选型建议，不是
> DSH 的保证。

## 链内排序

每一档是一个 `{provider, model, priority}` 列表，**`priority` 升序即回退顺序**
（[SPEC §10](../SPEC.md#10-configuration-reference)）。运行时失败的模型会被标记冷却，该档重新解析
到下一个可用模型，所以是链让一轮活下来（[SPEC §8](../SPEC.md#8-runtime-failover)）。

- **回退项必须与主项不同** —— 不同的模型 id、不同的 Provider，或两者都不同。重复同一条路由会让链
  成为空操作，卡片会直接指出。
- **链要短而有意义。** 两个你真的信任的条目，胜过十个从未演练过的；每多一个条目，就多一个
  「该 Provider 可达」的承诺。
- **按你自己的证据排序。** 没见过某模型失败，就把它放在你见过失败的那个之后。

> 来源：SPEC §8 与 §10（本仓库规范），读取于 2026-09-21。

## 图片输入与声明的模态

读图不是「好好请求」就能做到：DSH 在工具执行**之前**检查**已解析路由声明的模态**。`read_image`
会这样拒绝：

```
cannot read "<path>" as an image: model "<model>" does not declare image input;
switch to an image-capable model to read images
```

> 来源：`@deepseek-ai/dsh-tool-fs` 0.1.5-rc.2，`lib/index.js`（`assertImageCapableRoute`），读取于
> 2026-09-21。同一道门禁也存在于 `dsh-acp` 与 `dsh-mcp-client`。

所以，一个**确实**能接收图片的模型，在**路由**声明它能之前仍然会失败：

- 声明是按模型做的，写在 Provider 配置里。pi-ai 的 Provider 用 **`input`**；直连 DeepSeek 适配器用
  **`inputModalities`**（官方指南，2026-09-21）。
- 省略或为空的 `input` 先继承已安装目录，再回退到路由的 `defaultInput`（默认 `[text]`）—— 它是
  **回退值而非覆盖值**，绝不会把目录模型本来就有的图片能力去掉。没有显式 `models` 列表的内置
  Provider，把逐模型覆盖写在 `modelOverrides` 下，以模型 id 为键。
- 直连 DeepSeek 适配器把省略的 `inputModalities` 视为**纯文本**，并**拒绝空列表**。
- **这个声明是你对端点的断言，不是 DSH 对端点的检查。** 你把一个 Provider 实际不支持的模型标成
  支持图片，DSH 不会在这里拦下，改由 Provider 拒绝该请求。只标注你验证过的。

已验证的例子，以及两个陷阱：

| 家族 | 见过具备图片能力的 id | 见过纯文本的 id |
|---|---|---|
| Anthropic | `claude-opus-5`、`claude-sonnet-5` | — |
| OpenAI | `gpt-5.6-sol`、`gpt-5.6-terra`、`gpt-5.6-luna` | — |
| Google | `gemini-3.8-flash`、`gemini-3.7-flash`、`gemini-3.6-flash` | — |
| Qwen | `qwen3.8-max`、`qwen3.8-flash`、`qwen3.8-27b`、`qwen3.7-flash`、`qwen3.7-plus` | `qwen3.8-2.4t-a95b` |
| Z.ai（GLM） | `glm-5.3-flash`、`glm-5.3-flashx` | `glm-5.3` |
| Moonshot | `kimi-k3` | — |
| DeepSeek | `deepseek/deepseek-v4.1-flash`、`deepseek/deepseek-v4-flash-vision-exp`、`deepseek-flash` | `deepseek/deepseek-v4-pro`、`deepseek/deepseek-v4-flash`、`deepseek/deepseek-v4-pro-0813` |

> 来源：`https://openrouter.ai/api/v1/models`，抓取于 2026-09-21（逐模型
> `architecture.input_modalities`）；不带前缀的 `deepseek-*` id 及其模态来自 `deepseek-official`
> 路由自身的 `DEFAULT_MODELS`（`@deepseek-ai/dsh-llm-deepseek` 0.1.5-rc.2）。此外，`claude-sonnet-5`、
> `gpt-5.6-*`、`kimi-k3`、`MiniMax-M3`、`Qwen/Qwen3.8-*`、`xai/grok-4.6` 已在某个部署的
> `settings.yaml`（2026-09-21）中被确认声明为图片模型 —— 那是例子，不是清单。

**不要按家族推断。** `glm-5.3` 是纯文本，而它的 `-flash` 兄弟收图片与视频；`qwen3.8-2.4t-a95b`
是纯文本，同代其它 3.8 模型却不是；而在 `deepseek-official` 路由上，名字**听起来更新**的
`deepseek-v4-pro` 是纯文本，`deepseek-flash` 反而不是。

## 一个可照抄的双档配置

两个入口写的是同一份东西。这里只出现 `deepseek-official` 的 id，因为该路由的模型清单就是 DSH
适配器自己的（来源见下）—— 换成你的目录真正广告的 id。

作为 `~/.dsh/profiles/web/cordis.patch.yml` 里的 patch 行（patch 行会**替换整个 `config` 值**，
因此需要的键都要重述 —— [SPEC §10](../SPEC.md#10-configuration-reference)）：

```yaml
- id: shift-router
  config:
    tiers:
      fast:
        models:
          - { provider: deepseek-official, model: deepseek-flash, priority: 1 }
          - { provider: deepseek-official, model: deepseek-v4-flash, priority: 2 }
      smart:
        models:
          - { provider: deepseek-official, model: deepseek-v4-pro, priority: 1 }
```

等价的 `$DSH_HOME/settings.yaml` 写法 —— GUI 卡片与 `/router config` 写的就是它：

```yaml
shift-router:
  tiers:
    fast:
      models:
        - provider: deepseek-official
          model: deepseek-flash
          priority: 1
        - provider: deepseek-official
          model: deepseek-v4-flash
          priority: 2
    smart:
      models:
        - provider: deepseek-official
          model: deepseek-v4-pro
          priority: 1
```

为什么是这个形状：Fast 主项是适配器里支持图片的 Fast 模型，这样截图类工作能留在 Fast 上完成；回退项是
**另一个模型 id**（纯文本兄弟模型，所以链不是空操作）；Smart 则升级到推理模型。这与
[README](../README.md) 演示的 Fast/Smart 组合一致。如果你把 Fast 链换成旗舰模型，那么**每一次裁判
调用**都会按旗舰价格计费 —— 见上面「什么样的模型适合做 Fast」。

> 来源：这四个 `deepseek-official` id 及其声明的模态来自 `@deepseek-ai/dsh-llm-deepseek` 0.1.5-rc.2
> 的 `DEFAULT_MODELS`（`lib/index.js`），读取于 2026-09-21；链的顺序与 [README](../README.md)
> 的示例一致。该路由的价格取决于你自己的 Provider 与
> 凭据，本页刻意不做断言。

## 如何验证一档真的能解析

1. **卡片。** 设置 → 插件 → 插件配置 → *Shift-Router*：下拉**就是**运行时目录；空档、重复路由、
   Fast/Smart 主项相同都会被卡片直接指出（[SPEC §12.3](../SPEC.md#123-card-ux-rules-normative)）。
2. **`/router status`** —— 已配置的链、当前档位，以及上一次判定
   （[SPEC §11](../SPEC.md#11-commands)）。
3. **跑一轮真实对话。** 切换会往会话里写一条 `[shift-router] …` 通知；打开 `ux.routerLogVerbose`
   则每一轮判定都会报告（[SPEC §13.1](../SPEC.md#131-route-notices-normative)）—— 这是「实际跑了
   哪个模型」的唯一证明。
4. **组合后的行** —— `dsh --profile <name> --dump-config` 看你那行 patch 是否生效。

如果某一档始终为空，路由器会**保持原位**而不是猜测；空链或惰性链在第 1、2 步就能看见，而不必等到
路由行为异常才发现。

> 来源：SPEC §11–§13.1 与本仓库 [README §安装](../README.md#install)，读取于 2026-09-21。

## 来源

以上所有内容都可追溯到下列来源，全部抓取或读取于 **2026-09-21**：

| # | 来源 | 它确立了什么 |
|---|---|---|
| 1 | `@deepseek-ai/dsh-llm-deepseek` 0.1.5-rc.2 的 `lib/index.js`（`DEFAULT_MODELS`、`DEFAULT_CONTEXT_WINDOW`） | `deepseek-official` 路由的真实 id、1 M 上下文窗口、声明的模态 |
| 2 | 某个真实部署的 `$DSH_HOME/settings.yaml`（`llm-pi-ai.providers`）—— 例子，不是清单 | 该部署声明了哪些 id、它们的 `contextWindow`、以及哪些带 `input: [text, image]` |
| 3 | `https://openrouter.ai/api/v1/models` | 跨 Provider 的实时目录：id、`context_length`、`architecture.input_modalities`、`pricing` |
| 4 | `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/docs/user/guide/providers.zh.md`（英文版 `providers.md`） | DSH 自己的说法：内置 Provider 由已安装目录作答；`input` 与 `inputModalities` 之别；继承与 `defaultInput`；「是断言不是检查」 |
| 5 | `@deepseek-ai/dsh-tool-fs` 0.1.5-rc.2 的 `lib/index.js`（`assertImageCapableRoute`） | 图片能力被拒绝时的确切文案，以及它解析的是哪条路由 |
| 6 | 本仓库：[SPEC](../SPEC.md) §3、§5、§6.4、§8、§10、§11、§12.2、§12.3、§13.1 与 [README](../README.md) | 路由器自身的规范行为；这里只链接，不复述 |

以下内容**刻意不写**，因为没有任何抓取到的来源支持：`deepseek-official` 的逐模型价格、延迟/吞吐
排名，以及任何「最佳模型」结论。请改读你自己的目录。
