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
  | 's.general'
  | 's.routing'
  | 's.orchestration'
  | 's.failover'
  | 's.telemetry'
  | 's.ux'
  | 'f.enabled'
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

export type ShiftRouterCardDict = Record<ShiftRouterCardKey, string>

/** English copy. */
export const en: ShiftRouterCardDict = {
  title: 'Model router',
  description: 'Two-tier LLM routing, judge, and failover for this deployment.',
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
  's.general': 'General',
  's.routing': 'Routing',
  's.orchestration': 'Orchestration',
  's.failover': 'Failover',
  's.telemetry': 'Telemetry',
  's.ux': 'UX',
  'f.enabled': 'Enabled',
  'f.routingMode': 'Routing mode',
  'f.judgeTimeout': 'Judge timeout (ms)',
  'f.judgeMaxTokens': 'Judge max tokens',
  'f.judgePromptCap': 'Judge prompt cap (chars)',
  'f.windowSize': 'Window size',
  'f.windowThreshold': 'Window threshold',
  'f.windowMinConfidence': 'Window min confidence',
  'f.cacheAwareEnabled': 'Cache-aware routing',
  'f.sameFamilyThreshold': 'Same-family threshold',
  'f.idleBoundaryMs': 'Idle boundary (ms)',
  'f.orchMode': 'Orchestration mode',
  'f.maxRounds': 'Max rounds',
  'f.escalationThreshold': 'Escalation threshold',
  'f.requireSmartModel': 'Require smart model on escalation',
  'f.failoverBaseMs': 'Backoff base (ms)',
  'f.failoverMaxMs': 'Backoff ceiling (ms)',
  'f.startAttempts4xx': '4xx attempts before cooldown',
  'f.speedWindowSize': 'Speed window size',
  'f.callLogCap': 'Call log cap',
  'f.routerLogVerbose': 'Verbose router logs',
  'h.enabled': 'Master switch: when off the router passes every turn through unchanged.',
  'h.routingMode': 'auto routes by the judge; manual applies overrides only; off stays passive.',
  'h.judgeTimeout': 'How long the judge call may take before it falls back to the fast tier.',
  'h.judgeMaxTokens': 'Output cap of the judge call.',
  'h.judgePromptCap': 'Input cap of the judge prompt; longer transcripts are truncated.',
  'h.windowSize': 'How many recent turns the routing decision looks at.',
  'h.windowThreshold': 'Fast-tier share needed to keep routing fast ([0,1]).',
  'h.windowMinConfidence': 'Minimum judge confidence before escalation ([0,1]).',
  'h.cacheAwareEnabled': 'Skip the judge when the request matches a recently cached family.',
  'h.sameFamilyThreshold': 'Similarity threshold for the cache-aware fast path ([0,1]).',
  'h.idleBoundaryMs': 'How long a cached decision stays fresh without activity.',
  'h.orchMode': 'auto orchestrates multi-round work; off disables the orchestrator.',
  'h.maxRounds': 'Upper bound on orchestrated rounds before the router insists on smart.',
  'h.escalationThreshold': 'How many escalations trigger the hard smart-model requirement.',
  'h.requireSmartModel': 'Once the threshold is hit, refuse fast-tier rounds.',
  'h.failoverBaseMs': 'Initial backoff for a failed model.',
  'h.failoverMaxMs': 'Backoff grows up to this ceiling.',
  'h.startAttempts4xx': 'How many 4xx responses a model may produce before cooldown.',
  'h.speedWindowSize': 'Turns over which per-model speed is measured.',
  'h.callLogCap': 'How many routed calls the telemetry ring keeps.',
  'h.routerLogVerbose': 'Log every routing decision instead of summarizing.',
}

/** Simplified Chinese copy. */
export const zh: ShiftRouterCardDict = {
  title: '模型路由',
  description: '本部署的两层 LLM 路由、裁判与故障转移配置。',
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
  invalidNumber: '请填数字；留空表示使用默认值。',
  's.general': '通用',
  's.routing': '路由',
  's.orchestration': '编排',
  's.failover': '故障转移',
  's.telemetry': '遥测',
  's.ux': 'UX',
  'f.enabled': '启用',
  'f.routingMode': '路由模式',
  'f.judgeTimeout': '裁判超时（毫秒）',
  'f.judgeMaxTokens': '裁判最大输出',
  'f.judgePromptCap': '裁判提示词上限（字符）',
  'f.windowSize': '窗口大小',
  'f.windowThreshold': '窗口阈值',
  'f.windowMinConfidence': '最低置信度',
  'f.cacheAwareEnabled': '缓存感知路由',
  'f.sameFamilyThreshold': '同族阈值',
  'f.idleBoundaryMs': '空闲边界（毫秒）',
  'f.orchMode': '编排模式',
  'f.maxRounds': '最大轮数',
  'f.escalationThreshold': '升级阈值',
  'f.requireSmartModel': '升级时要求智能模型',
  'f.failoverBaseMs': '退避基数（毫秒）',
  'f.failoverMaxMs': '退避上限（毫秒）',
  'f.startAttempts4xx': '4xx 触发冷却前次数',
  'f.speedWindowSize': '速度窗口大小',
  'f.callLogCap': '调用日志容量',
  'f.routerLogVerbose': '详细路由日志',
  'h.enabled': '总开关：关闭时所有请求原样通过，不做路由。',
  'h.routingMode': 'auto 由裁判决策；manual 仅应用手动覆盖；off 保持被动。',
  'h.judgeTimeout': '裁判调用允许运行多久，超时回退到快速层。',
  'h.judgeMaxTokens': '裁判调用的输出上限。',
  'h.judgePromptCap': '裁判提示词输入上限，超出截断。',
  'h.windowSize': '路由决策参考最近多少轮。',
  'h.windowThreshold': '快速层占比达到该值即保持快速（[0,1]）。',
  'h.windowMinConfidence': '触发升级所需的最低裁判置信度（[0,1]）。',
  'h.cacheAwareEnabled': '请求命中近期缓存的同族时跳过裁判。',
  'h.sameFamilyThreshold': '缓存感知快速路径的相似度阈值（[0,1]）。',
  'h.idleBoundaryMs': '缓存决策在无活动后保持多久有效。',
  'h.orchMode': 'auto 编排多轮工作；off 关闭编排器。',
  'h.maxRounds': '编排轮数上限，超过后路由强制走智能层。',
  'h.escalationThreshold': '触发硬性智能模型要求的升级次数。',
  'h.requireSmartModel': '达到阈值后拒绝快速层轮次。',
  'h.failoverBaseMs': '模型失败后的初始退避。',
  'h.failoverMaxMs': '退避增长的上限。',
  'h.startAttempts4xx': '模型在进入冷却前允许产生多少次 4xx。',
  'h.speedWindowSize': '统计单个模型速度所依据的轮数。',
  'h.callLogCap': '遥测环形缓冲保留的路由调用数。',
  'h.routerLogVerbose': '记录每条路由决策而非摘要。',
}
