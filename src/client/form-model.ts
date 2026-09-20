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
 * `src/commands.ts`: it lists the same scalar leaves plus the two tier model
 * chains, with a translated label key each. `pricing` stays with the CLI
 * editor and the profile patch; the GUI card edits scalar configuration and
 * the per-tier model chains only.
 */

/** One editable model in a tier chain (`{provider, model, priority}`). */
export interface ModelRow {
  provider: string
  model: string
  /** Chain order; lower wins. The GUI derives it from row order (1-based). */
  priority: number
}

/** A leaf field the GUI card can edit. */
export interface CardField {
  /** Dotted path inside the config, e.g. `routing.judgeTimeout`. */
  path: string
  /** Top-level settings-section key owning the leaf (the write target). */
  section: string
  /** Display group (one of {@link CARD_SECTIONS} ids) the field renders under. */
  display: string
  /** Dotted path of the leaf *within* the section, e.g. `judgeTimeout`. */
  key: string
  /** Value kind, driving the control and the draft parser. */
  type: 'boolean' | 'number' | 'enum' | 'models'
  /** Allowed values for `enum` fields. */
  enum?: readonly string[]
  /** Locale dict key of the field's label. */
  labelKey: string
  /** Locale dict key of the field's hint. */
  hintKey: string
  /** Unit shown as a suffix inside the control, e.g. "ms", "tokens", "0–1". */
  unit?: string
  /** Display sub-group (one of the section's group keys); optional. */
  group?: string
  /**
   * The leaf ships WITHOUT a value in the resolved config — unset is its real
   * default (a preset selector that is off until chosen, or a compatibility
   * knob that must stay inert). The card renders it blank ("default").
   */
  optional?: true
  /**
   * A pre-EV knob kept only so existing configs keep working. Implies
   * {@link optional}, and ships UNSET so it stays inert until the user writes
   * a value.
   */
  legacy?: true
}

export const CARD_FIELDS: readonly CardField[] = [
  { path: 'enabled', section: 'enabled', display: 'general', key: 'enabled', type: 'boolean', labelKey: 'f.enabled', hintKey: 'h.enabled' },
  { path: 'routing.mode', section: 'routing', display: 'routing', key: 'mode', type: 'enum', enum: ['auto', 'manual', 'off'], labelKey: 'f.routingMode', hintKey: 'h.routingMode' },
  { path: 'routing.judgeTimeout', section: 'routing', display: 'routing', key: 'judgeTimeout', type: 'number', unit: 'ms', group: 'g.judge', labelKey: 'f.judgeTimeout', hintKey: 'h.judgeTimeout' },
  { path: 'routing.judgeMaxTokens', section: 'routing', display: 'routing', key: 'judgeMaxTokens', type: 'number', unit: 'tokens', group: 'g.judge', labelKey: 'f.judgeMaxTokens', hintKey: 'h.judgeMaxTokens' },
  { path: 'routing.judgePromptCap', section: 'routing', display: 'routing', key: 'judgePromptCap', type: 'number', unit: 'chars', group: 'g.judge', labelKey: 'f.judgePromptCap', hintKey: 'h.judgePromptCap' },
  { path: 'routing.economics.reworkPenalty', section: 'routing', display: 'routing', key: 'economics.reworkPenalty', type: 'number', group: 'g.economics', labelKey: 'f.reworkPenalty', hintKey: 'h.reworkPenalty' },
  { path: 'routing.economics.downgradeMemory', section: 'routing', display: 'routing', key: 'economics.downgradeMemory', type: 'number', unit: 'turns', group: 'g.economics', labelKey: 'f.downgradeMemory', hintKey: 'h.downgradeMemory' },
  { path: 'routing.economics.mode', section: 'routing', display: 'routing', key: 'economics.mode', type: 'enum', enum: ['eco', 'default', 'sport'], group: 'g.economics', optional: true, labelKey: 'f.economicsMode', hintKey: 'h.economicsMode' },
  { path: 'routing.window.size', section: 'routing', display: 'routing', key: 'window.size', type: 'number', unit: 'turns', group: 'g.window', labelKey: 'f.windowSize', hintKey: 'h.windowSize' },
  { path: 'routing.window.threshold', section: 'routing', display: 'routing', key: 'window.threshold', type: 'number', unit: '0–1', group: 'g.window', optional: true, legacy: true, labelKey: 'f.windowThreshold', hintKey: 'h.windowThreshold' },
  { path: 'routing.window.minConfidence', section: 'routing', display: 'routing', key: 'window.minConfidence', type: 'number', unit: '0–1', group: 'g.window', labelKey: 'f.windowMinConfidence', hintKey: 'h.windowMinConfidence' },
  { path: 'routing.cacheAware.enabled', section: 'routing', display: 'routing', key: 'cacheAware.enabled', type: 'boolean', group: 'g.cache', labelKey: 'f.cacheAwareEnabled', hintKey: 'h.cacheAwareEnabled' },
  { path: 'routing.cacheAware.sameFamilyPenalty', section: 'routing', display: 'routing', key: 'cacheAware.sameFamilyPenalty', type: 'number', group: 'g.cache', labelKey: 'f.sameFamilyPenalty', hintKey: 'h.sameFamilyPenalty' },
  { path: 'routing.cacheAware.sameFamilyThreshold', section: 'routing', display: 'routing', key: 'cacheAware.sameFamilyThreshold', type: 'number', unit: '0–1', group: 'g.cache', optional: true, legacy: true, labelKey: 'f.sameFamilyThreshold', hintKey: 'h.sameFamilyThreshold' },
  { path: 'routing.cacheAware.idleBoundaryMs', section: 'routing', display: 'routing', key: 'cacheAware.idleBoundaryMs', type: 'number', unit: 'ms', group: 'g.cache', labelKey: 'f.idleBoundaryMs', hintKey: 'h.idleBoundaryMs' },
  { path: 'orchestration.mode', section: 'orchestration', display: 'orchestration', key: 'mode', type: 'enum', enum: ['auto', 'off'], labelKey: 'f.orchMode', hintKey: 'h.orchMode' },
  { path: 'orchestration.maxRounds', section: 'orchestration', display: 'orchestration', key: 'maxRounds', type: 'number', unit: 'rounds', labelKey: 'f.maxRounds', hintKey: 'h.maxRounds' },
  { path: 'orchestration.escalationThreshold', section: 'orchestration', display: 'orchestration', key: 'escalationThreshold', type: 'number', unit: '×', labelKey: 'f.escalationThreshold', hintKey: 'h.escalationThreshold' },
  { path: 'failover.baseMs', section: 'failover', display: 'failover', key: 'baseMs', type: 'number', unit: 'ms', labelKey: 'f.failoverBaseMs', hintKey: 'h.failoverBaseMs' },
  { path: 'failover.maxMs', section: 'failover', display: 'failover', key: 'maxMs', type: 'number', unit: 'ms', labelKey: 'f.failoverMaxMs', hintKey: 'h.failoverMaxMs' },
  { path: 'failover.startAttempts4xx', section: 'failover', display: 'failover', key: 'startAttempts4xx', type: 'number', unit: '×', labelKey: 'f.startAttempts4xx', hintKey: 'h.startAttempts4xx' },
  { path: 'telemetry.callLogCap', section: 'telemetry', display: 'telemetry', key: 'callLogCap', type: 'number', unit: 'calls', labelKey: 'f.callLogCap', hintKey: 'h.callLogCap' },
  { path: 'ux.routerLogVerbose', section: 'ux', display: 'ux', key: 'routerLogVerbose', type: 'boolean', labelKey: 'f.routerLogVerbose', hintKey: 'h.routerLogVerbose' },
  { path: 'ux.promptSectionOrder', section: 'ux', display: 'ux', key: 'promptSectionOrder', type: 'number', labelKey: 'f.promptSectionOrder', hintKey: 'h.promptSectionOrder' },
  { path: 'tiers.fast.models', section: 'tiers', display: 'models', key: 'fast.models', type: 'models', labelKey: 'f.fastModels', hintKey: 'h.fastModels' },
  { path: 'tiers.smart.models', section: 'tiers', display: 'models', key: 'smart.models', type: 'models', labelKey: 'f.smartModels', hintKey: 'h.smartModels' },
]

/** One display group: its id matches `CardField.display`, plus locale keys. */
export interface CardSection {
  id: string
  labelKey: string
  /** Optional one-line section summary under the heading. */
  summaryKey?: string
}

/** Sections in display order. */
export const CARD_SECTIONS: readonly CardSection[] = [
  { id: 'general', labelKey: 's.general' },
  { id: 'models', labelKey: 's.models', summaryKey: 's.modelsSummary' },
  { id: 'routing', labelKey: 's.routing', summaryKey: 's.routingSummary' },
  { id: 'orchestration', labelKey: 's.orchestration', summaryKey: 's.orchestrationSummary' },
  { id: 'failover', labelKey: 's.failover', summaryKey: 's.failoverSummary' },
  { id: 'telemetry', labelKey: 's.telemetry', summaryKey: 's.telemetrySummary' },
  { id: 'ux', labelKey: 's.ux', summaryKey: 's.uxSummary' },
]

/** A staged edit: the control's raw text or model rows, plus whether it means "re-inherit". */
export interface StagedDraft {
  text?: string
  rows?: ModelRow[]
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

/** Render a scalar field's effective value as the control's initial text. */
export function formatValue(value: unknown, field: CardField): string {
  if (value === undefined || value === null) return ''
  if (field.type === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

/** Render a tier model chain as the editor's rows. */
export function formatRows(value: unknown): ModelRow[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => {
    const ref = item !== null && typeof item === 'object' ? item as Record<string, unknown> : {}
    return {
      provider: typeof ref.provider === 'string' ? ref.provider : '',
      model: typeof ref.model === 'string' ? ref.model : '',
      priority: typeof ref.priority === 'number' ? ref.priority : index + 1,
    }
  })
}

/**
 * Parse a model-chain draft. Fully blank rows are dropped; a row with only
 * one of provider/model filled blocks the save (invalid). Priorities are
 * re-derived from row order, so the first row is always the primary model
 * and the rest are its in-tier fallbacks.
 */
export function parseModelRows(rows: readonly ModelRow[]): { kind: 'set'; value: ModelRow[] } | undefined {
  const cleaned: ModelRow[] = []
  for (let index = 0; index < rows.length; index++) {
    const provider = rows[index]!.provider.trim()
    const model = rows[index]!.model.trim()
    if (provider === '' && model === '') continue
    if (provider === '' || model === '') return undefined
    cleaned.push({ provider, model, priority: cleaned.length + 1 })
  }
  return { kind: 'set', value: cleaned }
}

/**
 * Parse a scalar control draft into a write or a clear.
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

/** Recursively drop empty objects so a cleared leaf does not leave `{fast:{}}` shells. */
function pruneEmptyObjects(target: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(target)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      pruneEmptyObjects(value as Record<string, unknown>)
      if (Object.keys(value as Record<string, unknown>).length === 0) delete target[key]
    }
  }
}

/** Parse one staged draft through the field's own rules. */
export function parseStaged(
  field: CardField,
  draft: StagedDraft,
): { kind: 'clear' } | { kind: 'set'; value: unknown } | undefined {
  if (draft.clear) return { kind: 'clear' }
  if (field.type === 'models') return parseModelRows(draft.rows ?? [])
  return parseDraft(draft.text ?? '', field)
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
    const parsed = parseStaged(field, draft)
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
    // Drop empty shells left by clears, then skip when the user layer already
    // holds exactly what we would write.
    pruneEmptyObjects(next)
    if (deepEqual(next, currentUser)) continue
    if (Object.keys(next).length === 0) {
      patches.push({ op: 'unset', section, leaves })
    } else {
      patches.push({ op: 'set', section, value: next, leaves })
    }
  }

  return { invalid, patches }
}
