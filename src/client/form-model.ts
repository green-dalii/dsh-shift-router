/**
 * dsh-shift-router — client-side settings form model
 *
 * Pure, zero-import logic behind the GUI configuration card. The card edits
 * leaf fields of the `shift-router` settings namespace; because the settings
 * document is composed per-leaf (schema defaults ← composition base ← user
 * layer, deep-merged), each top-level section is written as one unit. A
 * section write carries only the leaves this card staged — untouched leaves
 * keep whatever the base or an earlier override supplies.
 *
 * The card must stay dependency-free on the browser side, so this module is
 * duplicated *shape* (not code) with the host's `CONFIG_FIELDS` in
 * `src/commands.ts`: it lists the same scalar leaves with a translated label
 * key. Complex fields (`tiers.*.models`, `pricing`) stay with the CLI editor
 * and the profile patch; the GUI card edits scalar configuration only.
 */

/** A leaf field the GUI card can edit. */
export interface CardField {
  /** Dotted path inside the config, e.g. `routing.judgeTimeout`. */
  path: string
  /** Top-level settings-section key owning the leaf, e.g. `routing`. */
  section: string
  /** Dotted path of the leaf *within* the section, e.g. `judgeTimeout`. */
  key: string
  /** Value kind, driving the control and the draft parser. */
  type: 'boolean' | 'number' | 'enum'
  /** Allowed values for `enum` fields. */
  enum?: readonly string[]
  /** Locale dict key of the field's label. */
  labelKey: string
  /** Locale dict key of the field's hint. */
  hintKey: string
  /** Display hint, e.g. "ms", "[0,1]". */
  hint?: string
}

export const CARD_FIELDS: readonly CardField[] = [
  { path: 'enabled', section: 'enabled', key: 'enabled', type: 'boolean', labelKey: 'f.enabled', hintKey: 'h.enabled' },
  { path: 'routing.mode', section: 'routing', key: 'mode', type: 'enum', enum: ['auto', 'manual', 'off'], labelKey: 'f.routingMode', hintKey: 'h.routingMode' },
  { path: 'routing.judgeTimeout', section: 'routing', key: 'judgeTimeout', type: 'number', hint: 'ms', labelKey: 'f.judgeTimeout', hintKey: 'h.judgeTimeout' },
  { path: 'routing.judgeMaxTokens', section: 'routing', key: 'judgeMaxTokens', type: 'number', labelKey: 'f.judgeMaxTokens', hintKey: 'h.judgeMaxTokens' },
  { path: 'routing.judgePromptCap', section: 'routing', key: 'judgePromptCap', type: 'number', labelKey: 'f.judgePromptCap', hintKey: 'h.judgePromptCap' },
  { path: 'routing.window.size', section: 'routing', key: 'window.size', type: 'number', labelKey: 'f.windowSize', hintKey: 'h.windowSize' },
  { path: 'routing.window.threshold', section: 'routing', key: 'window.threshold', type: 'number', hint: '[0,1]', labelKey: 'f.windowThreshold', hintKey: 'h.windowThreshold' },
  { path: 'routing.window.minConfidence', section: 'routing', key: 'window.minConfidence', type: 'number', hint: '[0,1]', labelKey: 'f.windowMinConfidence', hintKey: 'h.windowMinConfidence' },
  { path: 'routing.cacheAware.enabled', section: 'routing', key: 'cacheAware.enabled', type: 'boolean', labelKey: 'f.cacheAwareEnabled', hintKey: 'h.cacheAwareEnabled' },
  { path: 'routing.cacheAware.sameFamilyThreshold', section: 'routing', key: 'cacheAware.sameFamilyThreshold', type: 'number', hint: '[0,1]', labelKey: 'f.sameFamilyThreshold', hintKey: 'h.sameFamilyThreshold' },
  { path: 'routing.cacheAware.idleBoundaryMs', section: 'routing', key: 'cacheAware.idleBoundaryMs', type: 'number', hint: 'ms', labelKey: 'f.idleBoundaryMs', hintKey: 'h.idleBoundaryMs' },
  { path: 'orchestration.mode', section: 'orchestration', key: 'mode', type: 'enum', enum: ['auto', 'off'], labelKey: 'f.orchMode', hintKey: 'h.orchMode' },
  { path: 'orchestration.maxRounds', section: 'orchestration', key: 'maxRounds', type: 'number', labelKey: 'f.maxRounds', hintKey: 'h.maxRounds' },
  { path: 'orchestration.escalationThreshold', section: 'orchestration', key: 'escalationThreshold', type: 'number', labelKey: 'f.escalationThreshold', hintKey: 'h.escalationThreshold' },
  { path: 'orchestration.requireSmartModel', section: 'orchestration', key: 'requireSmartModel', type: 'boolean', labelKey: 'f.requireSmartModel', hintKey: 'h.requireSmartModel' },
  { path: 'failover.baseMs', section: 'failover', key: 'baseMs', type: 'number', hint: 'ms', labelKey: 'f.failoverBaseMs', hintKey: 'h.failoverBaseMs' },
  { path: 'failover.maxMs', section: 'failover', key: 'maxMs', type: 'number', hint: 'ms', labelKey: 'f.failoverMaxMs', hintKey: 'h.failoverMaxMs' },
  { path: 'failover.startAttempts4xx', section: 'failover', key: 'startAttempts4xx', type: 'number', labelKey: 'f.startAttempts4xx', hintKey: 'h.startAttempts4xx' },
  { path: 'failover.speedWindowSize', section: 'failover', key: 'speedWindowSize', type: 'number', labelKey: 'f.speedWindowSize', hintKey: 'h.speedWindowSize' },
  { path: 'telemetry.callLogCap', section: 'telemetry', key: 'callLogCap', type: 'number', labelKey: 'f.callLogCap', hintKey: 'h.callLogCap' },
  { path: 'ux.routerLogVerbose', section: 'ux', key: 'routerLogVerbose', type: 'boolean', labelKey: 'f.routerLogVerbose', hintKey: 'h.routerLogVerbose' },
]

/** Sections in display order: id → locale dict key of the section heading. */
export const CARD_SECTIONS: readonly { id: string; labelKey: string }[] = [
  { id: 'enabled', labelKey: 's.general' },
  { id: 'routing', labelKey: 's.routing' },
  { id: 'orchestration', labelKey: 's.orchestration' },
  { id: 'failover', labelKey: 's.failover' },
  { id: 'telemetry', labelKey: 's.telemetry' },
  { id: 'ux', labelKey: 's.ux' },
]

/** A staged edit: the control's raw text plus whether it means "re-inherit". */
export interface StagedDraft {
  text: string
  clear: boolean
}

/** Read a dotted path from an object (undefined when absent). */
export function readPath(obj: unknown, path: string): unknown {
  let current: unknown = obj
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** Whether a dotted path is present (hasOwn) at every hop. */
export function hasPath(obj: unknown, path: string): boolean {
  let current: unknown = obj
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return false
    const record = current as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(record, segment)) return false
    current = record[segment]
  }
  return true
}

/** Set a dotted path on a plain object (creating intermediate objects). */
export function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.')
  let node = target
  for (const segment of segments.slice(0, -1)) {
    const next = node[segment]
    if (next === null || typeof next !== 'object' || Array.isArray(next)) {
      node[segment] = {}
    }
    node = node[segment] as Record<string, unknown>
  }
  node[segments[segments.length - 1]!] = value
}

/** Delete a dotted path; intermediate objects are left in place. */
export function deletePath(target: Record<string, unknown>, path: string): void {
  const segments = path.split('.')
  let node: Record<string, unknown> | undefined = target
  for (const segment of segments.slice(0, -1)) {
    const next = node?.[segment]
    if (next === null || typeof next !== 'object' || Array.isArray(next)) return
    node = next as Record<string, unknown>
  }
  if (node !== undefined) delete node[segments[segments.length - 1]!]
}

/** Plain deep equality (JSON-shaped values). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, (b as unknown[])[index]))
  }
  if (a !== null && typeof a === 'object' && b !== null && typeof b === 'object') {
    const ar = a as Record<string, unknown>
    const br = b as Record<string, unknown>
    const ak = Object.keys(ar)
    const bk = Object.keys(br)
    if (ak.length !== bk.length) return false
    return ak.every((key) => deepEqual(ar[key], br[key]))
  }
  return false
}

/** Render a field's effective value as the control's initial text. */
export function formatValue(value: unknown, field: CardField): string {
  if (value === undefined || value === null) return ''
  if (field.type === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

/**
 * Parse a control draft into a write or a clear.
 * @returns `{kind:'clear'}` for blank drafts, `{kind:'set', value}` for
 * accepted values, or `undefined` for an invalid draft (blocks save).
 */
export function parseDraft(
  text: string,
  field: CardField,
): { kind: 'clear' } | { kind: 'set'; value: unknown } | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'clear' }
  if (field.type === 'boolean') {
    if (trimmed === 'true') return { kind: 'set', value: true }
    if (trimmed === 'false') return { kind: 'set', value: false }
    return undefined
  }
  if (field.type === 'enum') {
    if (field.enum?.includes(trimmed)) return { kind: 'set', value: trimmed }
    return undefined
  }
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? { kind: 'set', value: parsed } : undefined
}

/** One write the card would perform on save. */
export interface SectionPatch {
  op: 'set' | 'unset'
  section: string
  /** Full next user-layer section for `set` ops. */
  value?: Record<string, unknown>
  /** Leaves this patch writes; used to verify the write landed. */
  leaves: { key: string; value: unknown }[]
}

/** The card's save plan: per-section patches, or `invalid` when a draft fails. */
export interface SavePlan {
  invalid: boolean
  patches: SectionPatch[]
}

/**
 * Build the save plan from the staged drafts over one scope snapshot.
 *
 * Semantics mirror the host's per-leaf composition: a section write carries
 * only the leaves this card touched, starting from the current user layer, so
 * untouched leaves keep their base or earlier override. A set whose value
 * equals the effective value is a no-op; a clear of a leaf that is not stored
 * is a no-op. A section whose user layer ends up empty is cleared wholesale.
 *
 * @param fields - the card's field registry.
 * @param staged - the staged drafts, keyed by field path.
 * @param snapshot - `value` (resolved config), `base` (composition layer),
 * `user` (raw user layer), as published by the settings scope.
 * @returns the plan; `invalid` blocks save, `patches` are applied in order.
 */
export function buildPlan(
  fields: readonly CardField[],
  staged: ReadonlyMap<string, StagedDraft>,
  snapshot: { value?: unknown; base?: unknown; user?: unknown },
): SavePlan {
  const bySection = new Map<string, { field: CardField; parsed: { kind: 'clear' } | { kind: 'set'; value: unknown } }[]>()
  let invalid = false

  for (const [path, draft] of staged) {
    const field = fields.find((candidate) => candidate.path === path)
    if (field === undefined) continue
    const parsed = draft.clear ? { kind: 'clear' as const } : parseDraft(draft.text, field)
    if (parsed === undefined) {
      invalid = true
      continue
    }
    const list = bySection.get(field.section) ?? []
    list.push({ field, parsed })
    bySection.set(field.section, list)
  }

  const patches: SectionPatch[] = []
  for (const [section, edits] of bySection) {
    const currentUser = readPath(snapshot.user, section)
    const next = structuredClone(
      currentUser !== null && typeof currentUser === 'object' && !Array.isArray(currentUser)
        ? currentUser as Record<string, unknown>
        : {},
    )
    const leaves: { key: string; value: unknown }[] = []
    let touched = false
    for (const { field, parsed } of edits) {
      if (parsed.kind === 'clear') {
        // No-op when the leaf is not stored; otherwise drop it from the user layer.
        if (!hasPath(currentUser, field.key)) continue
        deletePath(next, field.key)
        leaves.push({ key: field.key, value: undefined })
        touched = true
        continue
      }
      // A set equal to the effective value is a no-op.
      if (deepEqual(readPath(snapshot.value, field.path), parsed.value)) continue
      setPath(next, field.key, parsed.value)
      leaves.push({ key: field.key, value: parsed.value })
      touched = true
    }
    if (!touched) continue
    // Skip when the user layer already holds exactly what we would write.
    if (deepEqual(next, currentUser)) continue
    if (Object.keys(next).length === 0) {
      patches.push({ op: 'unset', section, leaves })
    } else {
      patches.push({ op: 'set', section, value: next, leaves })
    }
  }

  return { invalid, patches }
}
