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
  | 'g.judge'
  | 'g.window'
  | 'g.cache'
  | 'f.enabled'
  | 'f.fastModels'
  | 'f.smartModels'
  | 'f.routingMode'
  | 'f.judgeTimeout'
  | 'f.judgeMaxTokens'
  | 'f.judgePromptCap'
  | 'f.windowSize'
  | 'f.windowThreshold'
  | 'f.windowMinConfidence'
  | 'f.cacheAwareEnabled'
  | 'f.sameFamilyThreshold'
  | 'f.idleBoundaryMs'
  | 'f.orchMode'
  | 'f.maxRounds'
  | 'f.escalationThreshold'
  | 'f.requireSmartModel'
  | 'f.failoverBaseMs'
  | 'f.failoverMaxMs'
  | 'f.startAttempts4xx'
  | 'f.speedWindowSize'
  | 'f.callLogCap'
  | 'f.routerLogVerbose'
  | 'h.enabled'
  | 'h.fastModels'
  | 'h.smartModels'
  | 'h.routingMode'
  | 'h.judgeTimeout'
  | 'h.judgeMaxTokens'
  | 'h.judgePromptCap'
  | 'h.windowSize'
  | 'h.windowThreshold'
  | 'h.windowMinConfidence'
  | 'h.cacheAwareEnabled'
  | 'h.sameFamilyThreshold'
  | 'h.idleBoundaryMs'
  | 'h.orchMode'
  | 'h.maxRounds'
  | 'h.escalationThreshold'
  | 'h.requireSmartModel'
  | 'h.failoverBaseMs'
  | 'h.failoverMaxMs'
  | 'h.startAttempts4xx'
  | 'h.speedWindowSize'
  | 'h.callLogCap'
  | 'h.routerLogVerbose'
  | 'modelProvider'
  | 'modelName'
  | 'addModel'
  | 'removeModel'
  | 'noModels'
  | 'modelCustom'
  | 'modelLoading'
  | 'modelCatalogFailed'
  | 'modelCurrent'

export type ShiftRouterCardDict = Record<ShiftRouterCardKey, string>

/** English copy. */
export const en: ShiftRouterCardDict = {
  title: 'Shift-Router',
  description: 'Two-tier model routing: fast for routine work, smart for complex work. Author: green-dalii',
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
  's.modelsSummary': 'Each tier is a model chain: the first available model in order is used, the rest are fallbacks.',
  's.routingSummary': 'A small judge decides each turn: routine work stays fast, consequential work escalates to smart.',
  's.orchestrationSummary': 'Complex tasks run on the smart model as an orchestrator that delegates to fast subagents.',
  's.failoverSummary': 'When a model fails, it enters an exponential-backoff cooldown and the same tier retries its next model.',
  's.telemetrySummary': 'How much routing telemetry is kept and how speed is measured.',
  's.uxSummary': 'Logging verbosity for the router itself.',
  'g.judge': 'Judge',
  'g.window': 'Decision window',
  'g.cache': 'Cache-aware routing',
  'f.enabled': 'Enable routing',
  'f.fastModels': 'Fast tier models',
  'f.smartModels': 'Smart tier models',
  'f.routingMode': 'Routing mode',
  'f.judgeTimeout': 'Judge timeout',
  'f.judgeMaxTokens': 'Judge max output',
  'f.judgePromptCap': 'Judge input cap',
  'f.windowSize': 'Decision window',
  'f.windowThreshold': 'Fast-share threshold',
  'f.windowMinConfidence': 'Min judge confidence',
  'f.cacheAwareEnabled': 'Cache-aware routing',
  'f.sameFamilyThreshold': 'Same-family threshold',
  'f.idleBoundaryMs': 'Cache idle boundary',
  'f.orchMode': 'Orchestration mode',
  'f.maxRounds': 'Max delegation rounds',
  'f.escalationThreshold': 'Escalation threshold',
  'f.requireSmartModel': 'Require smart model on escalation',
  'f.failoverBaseMs': 'Initial backoff',
  'f.failoverMaxMs': 'Backoff ceiling',
  'f.startAttempts4xx': '4xx start level',
  'f.speedWindowSize': 'Speed window',
  'f.callLogCap': 'Call log capacity',
  'f.routerLogVerbose': 'Verbose routing logs',
  'h.enabled': 'Master switch: when off, every request passes through unchanged.',
  'h.fastModels': 'Model chain for routine work, in fallback order — the first available model wins. The dropdowns list the models DSH currently has configured; use Custom to add others.',
  'h.smartModels': 'Model chain for complex work, in fallback order — the first available model wins. The dropdowns list the models DSH currently has configured; use Custom to add others.',
  'h.routingMode': 'auto: the judge decides every turn. manual: only explicit overrides apply. off: fully passive.',
  'h.judgeTimeout': 'How long the judge may run before routing falls back to fast.',
  'h.judgeMaxTokens': 'Output cap of the judge call.',
  'h.judgePromptCap': 'Input cap for the judge prompt; longer transcripts are truncated.',
  'h.windowSize': 'How many recent turns the downgrade decision reviews.',
  'h.windowThreshold': 'Fast share that keeps routing fast; dropping below it fires a downgrade.',
  'h.windowMinConfidence': 'Judge entries below this confidence are ignored by the window.',
  'h.cacheAwareEnabled': 'Keep the prompt cache warm: suppress same-family downgrades shortly after activity.',
  'h.sameFamilyThreshold': 'Stricter fast-share threshold used when both tiers share a provider family.',
  'h.idleBoundaryMs': 'A cached decision stays fresh this long after the last message.',
  'h.orchMode': 'auto: complex tasks escalate to a smart orchestrator that delegates to fast subagents. off: never orchestrate.',
  'h.maxRounds': 'Hard cap on delegated rounds before the orchestrator insists on smart.',
  'h.escalationThreshold': 'Worker failures that force the orchestrator to take over itself.',
  'h.requireSmartModel': 'Skip orchestration when no smart model can be resolved.',
  'h.failoverBaseMs': 'Cooldown after the first 5xx failure; each retry waits 4× longer.',
  'h.failoverMaxMs': 'Ceiling of the exponential backoff.',
  'h.startAttempts4xx': '429/quota failures start the backoff ladder at this level instead of level 1.',
  'h.speedWindowSize': 'Recent readings used for the tokens-per-second average.',
  'h.callLogCap': 'Telemetry keeps this many routed calls in its ring buffer.',
  'h.routerLogVerbose': 'Log every routing decision instead of a summary.',
  modelProvider: 'Provider',
  modelName: 'Model',
  addModel: 'Add model',
  removeModel: 'Remove model',
  noModels: 'No models yet — add the first one.',
  modelCustom: 'Custom…',
  modelLoading: 'Loading configured models…',
  modelCatalogFailed: 'Could not load the configured models — fill them in by hand.',
  modelCurrent: 'current',
}

/** Simplified Chinese copy. */
export const zh: ShiftRouterCardDict = {
  title: 'Shift-Router',
  description: '两层模型路由：日常任务走 Fast 层，复杂任务走 Smart 层。作者：green-dalii',
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
  's.modelsSummary': '每层都是一条模型链，按顺序优先使用第一个可用模型，其余作为后备。',
  's.routingSummary': '每轮由一个小型裁判决策：日常请求保持 Fast，重要请求升级到 Smart。',
  's.orchestrationSummary': '复杂任务由 Smart 模型担任编排者，委派 Fast 子代理执行并审查结果。',
  's.failoverSummary': '模型失败后进入指数退避冷却，同一层内自动重试下一个模型。',
  's.telemetrySummary': '路由遥测的保留量与速度统计口径。',
  's.uxSummary': '路由器自身的日志详细程度。',
  'g.judge': '裁判',
  'g.window': '决策窗口',
  'g.cache': '缓存感知',
  'f.enabled': '启用路由',
  'f.fastModels': 'Fast 层模型',
  'f.smartModels': 'Smart 层模型',
  'f.routingMode': '路由模式',
  'f.judgeTimeout': '裁判超时',
  'f.judgeMaxTokens': '裁判最大输出',
  'f.judgePromptCap': '裁判输入上限',
  'f.windowSize': '决策窗口大小',
  'f.windowThreshold': 'Fast 占比阈值',
  'f.windowMinConfidence': '最低置信度',
  'f.cacheAwareEnabled': '缓存感知路由',
  'f.sameFamilyThreshold': '同族相似度阈值',
  'f.idleBoundaryMs': '缓存空闲边界',
  'f.orchMode': '编排模式',
  'f.maxRounds': '最大委派轮数',
  'f.escalationThreshold': '升级阈值',
  'f.requireSmartModel': '升级时要求 Smart 模型',
  'f.failoverBaseMs': '初始退避',
  'f.failoverMaxMs': '退避上限',
  'f.startAttempts4xx': '4xx 起始等级',
  'f.speedWindowSize': '速度统计窗口',
  'f.callLogCap': '调用日志容量',
  'f.routerLogVerbose': '详细路由日志',
  'h.enabled': '总开关：关闭后所有请求原样通过，不做任何路由。',
  'h.fastModels': '日常事务模型链，按回退顺序排列——优先使用第一个可用模型。下拉选项来自 DSH 当前配置的模型；可选「自定义」手动填写。',
  'h.smartModels': '复杂任务模型链，按回退顺序排列——优先使用第一个可用模型。下拉选项来自 DSH 当前配置的模型；可选「自定义」手动填写。',
  'h.routingMode': 'auto：裁判每轮决策；manual：仅应用手动指定；off：完全被动。',
  'h.judgeTimeout': '裁判最长运行时间，超时自动回退到 Fast 层。',
  'h.judgeMaxTokens': '裁判调用的输出上限。',
  'h.judgePromptCap': '裁判提示词输入上限，超出部分截断。',
  'h.windowSize': '降级决策参考最近多少轮的结果。',
  'h.windowThreshold': 'Fast 占比保持在该值之上则继续走 Fast；跌破才触发降级。',
  'h.windowMinConfidence': '低于该置信度的裁判结果不计入窗口。',
  'h.cacheAwareEnabled': '保持提示词缓存有效：近期有活动时，抑制同供应商族的降级。',
  'h.sameFamilyThreshold': '两层同属一个供应商族时使用的更严格 Fast 占比阈值。',
  'h.idleBoundaryMs': '最近一条消息后，缓存决策在此时间内保持有效。',
  'h.orchMode': 'auto：复杂任务升级为 Smart 编排器，委派 Fast 子代理执行；off：永不编排。',
  'h.maxRounds': '编排器委派轮数的硬上限，达到后强制走 Smart。',
  'h.escalationThreshold': '子代理失败多少次后，编排器亲自接管。',
  'h.requireSmartModel': '无法解析出 Smart 模型时跳过编排。',
  'h.failoverBaseMs': '首次 5xx 故障后的冷却时长；每次重试等待翻 4 倍。',
  'h.failoverMaxMs': '指数退避的上限。',
  'h.startAttempts4xx': '429/配额类故障从该等级开始计退避，而非从第 1 级开始。',
  'h.speedWindowSize': '计算每秒 tokens 平均值所用的最近读数数量。',
  'h.callLogCap': '遥测环形缓冲保留的路由调用数。',
  'h.routerLogVerbose': '记录每条路由决策，而非只记摘要。',
  modelProvider: 'Provider',
  modelName: 'Model',
  addModel: '添加模型',
  removeModel: '移除模型',
  noModels: '暂无模型，先添加一个。',
  modelCustom: '自定义…',
  modelLoading: '正在加载已配置的模型…',
  modelCatalogFailed: '无法加载已配置的模型，请手动填写。',
  modelCurrent: '当前',
}
