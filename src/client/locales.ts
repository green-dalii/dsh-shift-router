/**
 * dsh-shift-router — GUI card locale dictionaries (zh/en)
 *
 * The key union is the `LocaleNamespaceMap` entry for the `shift-router`
 * namespace; the dictionaries below must carry exactly these keys (the locale
 * registry's typed registration enforces it at compile time).
 */

/** All dictionary keys the shift-router card renders. */
export type ShiftRouterCardKey =
  | 'title'
  | 'description'
  | 'expand'
  | 'collapse'
  | 'readOnly'
  | 'overridden'
  | 'reset'
  | 'save'
  | 'saving'
  | 'discard'
  | 'unsaved'
  | 'saveFailed'
  | 'invalidNumber'
  | 'invalidModels'
  | 's.general'
  | 's.models'
  | 's.routing'
  | 's.orchestration'
  | 's.failover'
  | 's.telemetry'
  | 's.ux'
  | 's.modelsSummary'
  | 's.routingSummary'
  | 's.orchestrationSummary'
  | 's.failoverSummary'
  | 's.telemetrySummary'
  | 's.uxSummary'
  | 's.advanced'
  | 's.advancedSummary'
  | 'advancedCount'
  | 'advancedChanged'
  | 'expandAdvanced'
  | 'collapseAdvanced'
  | 'g.judge'
  | 'g.window'
  | 'g.cache'
  | 'g.economics'
  | 'f.enabled'
  | 'f.fastModels'
  | 'f.smartModels'
  | 'f.routingMode'
  | 'f.judgeTimeout'
  | 'f.judgeMaxTokens'
  | 'f.judgePromptCap'
  | 'f.reworkPenalty'
  | 'f.downgradeMemory'
  | 'f.economicsMode'
  | 'f.windowSize'
  | 'f.windowThreshold'
  | 'f.windowMinConfidence'
  | 'f.cacheAwareEnabled'
  | 'f.sameFamilyPenalty'
  | 'f.sameFamilyThreshold'
  | 'f.idleBoundaryMs'
  | 'f.orchMode'
  | 'f.maxRounds'
  | 'f.escalationThreshold'
  | 'f.maxSpendUsd'
  | 'f.workerLedgerCap'
  | 'f.auditEnabled'
  | 'f.auditTimeoutMs'
  | 'f.auditPromptCap'
  | 'f.failoverBaseMs'
  | 'f.failoverMaxMs'
  | 'f.startAttempts4xx'
  | 'f.callLogCap'
  | 'f.routerLogVerbose'
  | 'f.promptSectionOrder'
  | 'h.enabled'
  | 'h.fastModels'
  | 'h.smartModels'
  | 'h.routingMode'
  | 'h.judgeTimeout'
  | 'h.judgeMaxTokens'
  | 'h.judgePromptCap'
  | 'h.reworkPenalty'
  | 'h.downgradeMemory'
  | 'h.economicsMode'
  | 'h.windowSize'
  | 'h.windowThreshold'
  | 'h.windowMinConfidence'
  | 'h.cacheAwareEnabled'
  | 'h.sameFamilyPenalty'
  | 'h.sameFamilyThreshold'
  | 'h.idleBoundaryMs'
  | 'h.orchMode'
  | 'h.maxRounds'
  | 'h.escalationThreshold'
  | 'h.maxSpendUsd'
  | 'h.workerLedgerCap'
  | 'h.auditEnabled'
  | 'h.auditTimeoutMs'
  | 'h.auditPromptCap'
  | 'h.failoverBaseMs'
  | 'h.failoverMaxMs'
  | 'h.startAttempts4xx'
  | 'h.callLogCap'
  | 'h.routerLogVerbose'
  | 'h.promptSectionOrder'
  | 'modelProvider'
  | 'modelName'
  | 'addModel'
  | 'removeModel'
  | 'noModels'
  | 'modelCustom'
  | 'modelLoading'
  | 'modelCatalogFailed'
  | 'modelCatalogUnavailable'
  | 'modelCatalogReason'
  | 'modelCurrent'
  | 'modelPrimary'
  | 'modelFallback'
  | 'modelPickProvider'
  | 'modelProviderUnavailable'
  | 'moveUp'
  | 'moveDown'
  | 'tierFast'
  | 'tierSmart'
  | 'chainEmptyTier'
  | 'chainDuplicateRoute'
  | 'chainSharedPrimary'
  | 'legacyField'
  | 'thresholdHint'
  | 'summaryDisabled'
  | 'summaryMode'
  | 'summaryChains'

export type ShiftRouterCardDict = Record<ShiftRouterCardKey, string>

/** English copy. */
export const en: ShiftRouterCardDict = {
  title: 'Shift-Router',
  description: 'Two-tier routing by expected cost: routine turns on the Fast chain, hard turns on Smart — with model fallbacks, failover and orchestration.',
  expand: 'Show settings',
  collapse: 'Hide settings',
  readOnly: 'This deployment stores settings read-only.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  invalidModels: 'Each row needs both a provider and a model — or leave the whole row blank.',
  's.general': 'General',
  's.models': 'Models',
  's.routing': 'Routing',
  's.orchestration': 'Orchestration',
  's.failover': 'Failover',
  's.telemetry': 'Telemetry',
  's.ux': 'Logs & UX',
  's.modelsSummary': 'Which model each tier uses, and what it falls back to.',
  's.routingSummary': 'When a request runs on the Fast model and when it moves up to the Smart one.',
  's.orchestrationSummary': 'Whether demanding requests are split across subagents, and what that may cost.',
  's.failoverSummary': 'When a model fails, it enters an exponential-backoff cooldown and the same tier retries its next model.',
  's.telemetrySummary': 'How much routing history /router status keeps.',
  's.uxSummary': 'How much the router writes to its log.',
  's.advanced': 'Advanced',
  's.advancedSummary': 'Fine-tuning for judge limits, switching rules, retries and logging. The defaults are safe — open this only if you need to change how the router behaves internally.',
  'advancedCount': '{n} settings',
  'advancedChanged': '{n} changed',
  'expandAdvanced': 'Show advanced settings',
  'collapseAdvanced': 'Hide advanced settings',
  'g.judge': 'Judge',
  'g.window': 'Decision window',
  'g.cache': 'Cache-aware routing',
  'g.economics': 'Economics',
  'f.enabled': 'Enable routing',
  'f.fastModels': 'Fast tier models',
  'f.smartModels': 'Smart tier models',
  'f.routingMode': 'Routing mode',
  'f.judgeTimeout': 'Judge time limit',
  'f.judgeMaxTokens': 'Judge answer limit',
  'f.judgePromptCap': 'Judge reading limit',
  'f.reworkPenalty': 'Cost of a wrong downgrade',
  'f.downgradeMemory': 'Fast turns before switching down',
  'f.economicsMode': 'Effort preset',
  'f.windowSize': 'Decisions remembered',
  'f.windowThreshold': 'Old threshold override (legacy)',
  'f.windowMinConfidence': 'Minimum judge confidence',
  'f.cacheAwareEnabled': 'Cache-aware switching',
  'f.sameFamilyPenalty': 'Shared-provider caution',
  'f.sameFamilyThreshold': 'Old cache threshold (legacy)',
  'f.idleBoundaryMs': 'Cache stays warm for',
  'f.orchMode': 'Orchestration mode',
  'f.maxRounds': 'Delegation rounds',
  'f.escalationThreshold': 'Worker failures per takeover',
  'f.maxSpendUsd': 'Spend limit (USD)',
  'f.workerLedgerCap': 'Cost rows kept',
  'f.auditEnabled': 'Check delegated results',
  'f.auditTimeoutMs': 'Check time limit',
  'f.auditPromptCap': 'Check reading limit',
  'f.failoverBaseMs': 'Wait after a failure',
  'f.failoverMaxMs': 'Longest wait',
  'f.startAttempts4xx': 'Rate-limit retry level',
  'f.callLogCap': 'Recent calls kept',
  'f.routerLogVerbose': 'Detailed routing logs',
  'f.promptSectionOrder': 'Prompt position',
  'h.enabled': 'Turn routing on or off. When off, every request goes to the model you already selected and nothing else on this page applies.',
  'h.fastModels': 'The models used for routine work, tried in order: the first one that answers wins, the rest are backups. Pick from the models this DSH is configured with, or choose Custom… to type an id.',
  'h.smartModels': 'The models used for complex work, tried in order: the first one that answers wins, the rest are backups. Pick from the models this DSH is configured with, or choose Custom… to type an id.',
  'h.routingMode': 'auto — the router judges every turn (recommended). manual — only your /route-force overrides apply. off — the router watches but never switches.',
  'h.judgeTimeout': 'How long the judgment call may take. If it runs over, the request carries on with the Fast model instead of waiting.',
  'h.judgeMaxTokens': 'How long the judgment call’s answer may be. The default is plenty; raise it only if judgments keep getting cut off.',
  'h.judgePromptCap': 'How much of the recent conversation the judgment call may read. Anything longer is shortened to fit.',
  'h.reworkPenalty': 'How much it costs you when a request goes to the Fast model and turns out to need the Smart one. Higher means the router keeps using the Smart model.',
  'h.downgradeMemory': 'How many clearly-Fast turns in a row are needed before switching down to Fast. Higher keeps you on the Smart model longer; an unclear verdict starts the count again.',
  'h.economicsMode': 'A quick way to set how eager the router is: eco saves money, default is balanced, sport prefers the Smart model. Choosing one replaces the cost setting above.',
  'h.windowSize': 'How many recent turns the router looks at when deciding to switch down. A longer memory means steadier but slower decisions.',
  'h.windowThreshold': 'A setting from an older version, kept so old configuration files still load. It has no effect; use the cost setting above or pick an effort preset instead.',
  'h.windowMinConfidence': 'How sure the judgment must be before the router acts on it. Below this it changes nothing and waits for a clearer signal.',
  'h.cacheAwareEnabled': 'When both tiers use the same provider: let the router switch down less often while that provider’s prompt cache is still warm, since switching would pay for the same prompt again.',
  'h.sameFamilyPenalty': 'How much more careful the router is about switching down when both tiers share one provider. Higher switches down less often.',
  'h.sameFamilyThreshold': 'A setting from an older version, kept so old configuration files still load. It has no effect; use the field above instead.',
  'h.idleBoundaryMs': 'How long a prompt cache counts as still warm after your last message. Past that, switching down is no longer made harder.',
  'h.orchMode': 'auto — demanding requests are given to a Smart orchestrator that splits the work across Fast subagents. off — never delegate.',
  'h.maxRounds': 'How many rounds of delegation may run before the orchestrator has to finish the job itself on the Smart model.',
  'h.escalationThreshold': 'How many workers must fail in a row before the orchestrator takes over. One success resets the count, so occasional failures do not end the run.',
  'h.maxSpendUsd': 'Stop delegating once this much has been spent on a single request. 0 means no limit. The total is estimated from the prices below, so with no prices configured it stays 0 and the limit cannot trigger.',
  'h.workerLedgerCap': 'How many per-worker cost lines /router status keeps. The task total is unaffected — this only limits how long the list is.',
  'h.auditEnabled': 'After a request that really did delegate, check the outcome: did every worker report back, and does the summary match the reports? Adds one small Fast-model call and never blocks the answer. Findings appear as “Last audit” in /router status.',
  'h.auditTimeoutMs': 'How long that check may take. The basic checks always run; the deeper review is best-effort.',
  'h.auditPromptCap': 'How much of the task and the workers’ reports the check may read. Longer material is shortened to fit, which also bounds what the check costs.',
  'h.failoverBaseMs': 'How long to wait after a provider fails before trying the next model. Every further attempt waits about four times longer.',
  'h.failoverMaxMs': 'The longest wait between attempts.',
  'h.startAttempts4xx': 'Rate-limit (429) errors start further up the retry ladder, so the router backs off sooner instead of hammering a busy provider.',
  'h.callLogCap': 'How many recent routed calls /router status counts in its statistics.',
  'h.routerLogVerbose': 'Write a line for every routing decision instead of a summary. Note: the standard DSH setup has nowhere to show plugin logs, so this only helps a deployment that collects them.',
  'h.promptSectionOrder': 'Where the orchestrator’s instructions sit in the system prompt. The default (150) puts them after the persona and before the plan policy — change it only if another plugin competes for this position.',
  modelProvider: 'Provider',
  modelName: 'Model',
  addModel: 'Add model',
  removeModel: 'Remove model',
  noModels: 'No models yet — add the first one.',
  modelCustom: 'Custom…',
  modelLoading: 'Loading configured models…',
  modelCatalogFailed: 'Could not load the configured models — enter them manually.',
  modelCatalogUnavailable: 'This shell does not expose the model catalog — enter models manually.',
  modelCatalogReason: 'Reason: {message}',
  modelCurrent: 'current',
  modelPrimary: 'Primary',
  modelFallback: 'Fallback {n}',
  modelPickProvider: 'Choose a provider…',
  modelProviderUnavailable: '{provider} could not list its models ({message}) — enter the model id by hand.',
  moveUp: 'Move up',
  moveDown: 'Move down',
  tierFast: 'Fast',
  tierSmart: 'Smart',
  chainEmptyTier: 'No {tier} model: that tier is disabled.',
  chainDuplicateRoute: '{tier} lists {route} twice; the repeat never runs.',
  chainSharedPrimary: 'Fast and Smart start on the same model, so the router cannot switch between them.',
  legacyField: 'Accepted but ignored',
  thresholdHint: 'θ ≈ {theta} — the Judge confidence at which the Smart tier is used.',
  summaryDisabled: 'disabled',
  summaryMode: '{mode} mode',
  summaryChains: 'Fast {fast} · Smart {smart}',
}

/** Simplified Chinese copy. */
export const zh: ShiftRouterCardDict = {
  title: 'Shift-Router',
  description: '按期望成本做双层路由：日常任务走 Fast 链、复杂任务走 Smart——带模型回退、故障转移与编排。',
  expand: '展开设置',
  collapse: '收起设置',
  readOnly: '本部署的设置为只读。',
  overridden: '已覆盖',
  reset: '恢复默认',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  unsaved: '未保存',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidNumber: '请输入数字；留空表示使用默认值。',
  invalidModels: '每行需同时填写 provider 与 model，或整行留空。',
  's.general': '通用',
  's.models': '模型',
  's.routing': '路由',
  's.orchestration': '编排',
  's.failover': '故障转移',
  's.telemetry': '遥测',
  's.ux': '日志与体验',
  's.modelsSummary': '两档各自使用哪个模型，以及它失败时回退到什么。',
  's.routingSummary': '什么情况下请求走 Fast 层，什么情况下升到 Smart 层。',
  's.orchestrationSummary': '复杂任务是否拆给子代理执行，以及可能产生多少花费。',
  's.failoverSummary': '模型失败后进入指数退避冷却，同一层内自动重试下一个模型。',
  's.telemetrySummary': '/router status 保留多少路由历史。',
  's.uxSummary': '路由器写多少日志。',
  's.advanced': '高级设置',
  's.advancedSummary': '裁判限制、切换规则、重试与日志的微调项。默认值已足够安全——只有确实需要改变路由器内部行为时才展开。',
  'advancedCount': '{n} 项',
  'advancedChanged': '{n} 项已覆盖',
  'expandAdvanced': '展开高级设置',
  'collapseAdvanced': '收起高级设置',
  'g.judge': '裁判',
  'g.window': '决策窗口',
  'g.cache': '缓存感知',
  'g.economics': '经济性',
  'f.enabled': '启用路由',
  'f.fastModels': 'Fast 层模型',
  'f.smartModels': 'Smart 层模型',
  'f.routingMode': '路由模式',
  'f.judgeTimeout': '裁判判定时限',
  'f.judgeMaxTokens': '裁判回答长度上限',
  'f.judgePromptCap': '裁判可读内容上限',
  'f.reworkPenalty': '一次错误降级的代价',
  'f.downgradeMemory': '降级前需连续 Fast 轮数',
  'f.economicsMode': '力度预设',
  'f.windowSize': '记忆的近期轮数',
  'f.windowThreshold': '旧版阈值覆盖（已废弃）',
  'f.windowMinConfidence': '最低置信度',
  'f.cacheAwareEnabled': '缓存感知的降级',
  'f.sameFamilyPenalty': '共用一个 provider 时的谨慎度',
  'f.sameFamilyThreshold': '旧版缓存阈值（已废弃）',
  'f.idleBoundaryMs': '缓存保持有效时长',
  'f.orchMode': '编排模式',
  'f.maxRounds': '委派轮数',
  'f.escalationThreshold': '接管前允许的连续失败数',
  'f.maxSpendUsd': '花费上限（USD）',
  'f.workerLedgerCap': '保留的成本明细条数',
  'f.auditEnabled': '检查委派结果',
  'f.auditTimeoutMs': '检查时限',
  'f.auditPromptCap': '检查可读内容上限',
  'f.failoverBaseMs': '失败后的等待时间',
  'f.failoverMaxMs': '最长等待',
  'f.startAttempts4xx': '限流重试起点',
  'f.callLogCap': '保留的近期调用数',
  'f.promptSectionOrder': '提示词中的位置',
  'f.routerLogVerbose': '详细路由日志',
  'h.enabled': '开关路由。关闭后所有请求都走你当前选定的模型，本页其他设置一律不生效。',
  'h.fastModels': '日常事务使用的模型，按顺序尝试：谁先可用就用谁，后面的作为备份。可从本 DSH 已配置的模型中挑选，也可选「自定义」手填 id。',
  'h.smartModels': '复杂任务使用的模型，按顺序尝试：谁先可用就用谁，后面的作为备份。可从本 DSH 已配置的模型中挑选，也可选「自定义」手填 id。',
  'h.routingMode': 'auto——每轮由路由器判定（推荐）；manual——只应用你用 /route-force 指定的模型；off——只观察、不切换。',
  'h.judgeTimeout': '判定调用的时限。超时就直接用 Fast 层继续，不再等待判定结果。',
  'h.judgeMaxTokens': '判定结果的最大长度。默认值通常足够；只有判定经常被截断时才需要调大。',
  'h.judgePromptCap': '判定可以读取多少近期对话内容，超出部分会被压缩。',
  'h.reworkPenalty': '一次请求走了 Fast 层、结果却需要 Smart 层时，你要付出多大代价。数值越大，越倾向于一直用 Smart 层。',
  'h.downgradeMemory': '需要连续多少轮明确判定为 Fast，才降级到 Fast 层。数值越大越久留在 Smart 层；判定不明确会重新计数。',
  'h.economicsMode': '快速设定路由的积极程度：eco 省钱、default 均衡、sport 偏向 Smart 层。选了预设会覆盖上面的代价设置。',
  'h.windowSize': '判断是否降级时，路由器回看多少轮。记忆越长，决策越稳但越慢。',
  'h.windowThreshold': '旧版本留下的设置，仅为让旧配置文件仍能加载。它不生效；请改用上面的代价设置或直接选力度预设。',
  'h.windowMinConfidence': '判定需要多确定才会被采信。低于该值时路由器什么都不改，等更明确的信号。',
  'h.cacheAwareEnabled': '两档共用同一个 provider 时：在该 provider 的提示词缓存还热的时候少降级——降级会让同一段提示词重新计费。',
  'h.sameFamilyPenalty': '两档共用同一个 provider 时，降级有多谨慎。数值越大，越少降级。',
  'h.sameFamilyThreshold': '旧版本留下的设置，仅为让旧配置文件仍能加载。它不生效；请改用上方字段。',
  'h.idleBoundaryMs': '最后一条消息之后，提示词缓存还算「热」的时长。超过这个时间，降级不再被额外抑制。',
  'h.orchMode': 'auto——复杂请求交给 Smart 编排器，再拆分给 Fast 子代理执行；off——永不委派。',
  'h.maxRounds': '最多可以委派几轮，之后编排器必须在 Smart 层亲自完成。',
  'h.escalationThreshold': '连续多少个 worker 失败后由编排器接管。中间只要成功一次就重新计数，所以偶发失败不会终止任务。',
  'h.maxSpendUsd': '单个请求的花费超过该值就停止委派。0 表示不限制。金额按下方的价格表估算，因此没有配置价格时花费恒为 0，该限制不会触发。',
  'h.workerLedgerCap': '/router status 保留多少条按 worker 拆分的成本明细。任务总额不受影响——这里只限制明细列表的长度。',
  'h.auditEnabled': '对确实发生委派的请求做一次结果检查：每个 worker 是否都回报了、总结与回报是否对得上。只增加一次很小的 Fast 层调用，绝不阻塞回答。结果见 /router status 的「Last audit」。',
  'h.auditTimeoutMs': '该检查的时限。基础检查总会执行，更深入的复核是尽力而为。',
  'h.auditPromptCap': '检查可以读取多少任务与 worker 回报内容，超出部分会被压缩——这也决定了该检查的成本上限。',
  'h.failoverBaseMs': '某个 provider 失败后，等多久再试下一个模型。之后每次尝试的等待时间约为上一次的 4 倍。',
  'h.failoverMaxMs': '两次尝试之间的最长等待时间。',
  'h.startAttempts4xx': '限流（429）错误从更高的重试档位开始，让路由器更快退避，而不是持续冲击已经很忙的 provider。',
  'h.callLogCap': '/router status 的统计里统计多少次近期路由调用。',
  'h.routerLogVerbose': '为每条路由决策都写一行日志，而不是只写摘要。注意：标准 DSH 环境没有地方显示插件日志，因此只有收集插件日志的部署才看得到。',
  'h.promptSectionOrder': '编排器的指令在系统提示词中的位置。默认值 150 位于人设之后、计划策略之前——只有当另一个插件也要占用这个位置时才需要改。',
  modelProvider: 'Provider',
  modelName: 'Model',
  addModel: '添加模型',
  removeModel: '移除模型',
  noModels: '暂无模型，先添加一个。',
  modelCustom: '自定义…',
  modelLoading: '正在加载已配置的模型…',
  modelCatalogFailed: '无法加载已配置的模型，请手动填写。',
  modelCatalogUnavailable: '当前 shell 未提供模型目录，请手动填写模型。',
  modelCatalogReason: '原因：{message}',
  modelCurrent: '当前',
  modelPrimary: '主选',
  modelFallback: '备选 {n}',
  modelPickProvider: '请选择 provider…',
  modelProviderUnavailable: '{provider} 无法列出模型（{message}），请手动填写模型 id。',
  moveUp: '上移',
  moveDown: '下移',
  tierFast: 'Fast 档',
  tierSmart: 'Smart 档',
  chainEmptyTier: '{tier}没有任何模型：该档位等于关闭。',
  chainDuplicateRoute: '{tier}重复列出 {route}，重复项永远不会被执行。',
  chainSharedPrimary: 'Fast 与 Smart 的首选模型相同，路由器无法在两档之间切换。',
  legacyField: '已被接受但会被忽略',
  thresholdHint: 'θ ≈ {theta} —— Judge 置信度达到该值才走 Smart 档。',
  summaryDisabled: '已禁用',
  summaryMode: '{mode} 模式',
  summaryChains: 'Fast {fast} · Smart {smart}',
}
