/**
 * dsh-shift-router — GUI card controller
 *
 * Bridges the `shift-router` settings scope onto a staged form, mirroring the
 * host-plane card architecture of `dsh-client-ui-settings-plugins`: the user
 * types into controls, edits accumulate as drafts, and a save is the single
 * point where drafts become document mutations (per-section, revision-fenced
 * writes through the settings scope). Nothing here writes directly.
 */

import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CARD_FIELDS,
  buildPlan,
  deepEqual,
  formatValue,
  hasPath,
  parseDraft,
  readPath,
  type CardField,
  type SectionPatch,
  type StagedDraft,
} from './form-model.js'

/** One field's rendered state: the control's text and its override marker. */
export interface FieldState {
  path: string
  text: string
  /** Whether a save of the current draft would leave an override. */
  overridden: boolean
  /** Whether the current draft is not a value the field accepts. */
  invalid: boolean
}

/** The card's published snapshot (the store the slot entry injects). */
export interface ShiftRouterCardState {
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
  fields: FieldState[]
}

/** The face the slot registration injects into the card component. */
export interface ShiftRouterCardFace {
  hooks: {
    shiftRouterCard: SnapshotStore<ShiftRouterCardState>
  }
  edit(field: string, text: string): void
  resetField(field: string): void
  save(): Promise<void>
  discard(): void
}

/** Bridges one `shift-router` scope onto a staged form and its store. */
export class ShiftRouterCardController {
  private readonly scope: SettingsScope<unknown>
  private readonly fields: readonly CardField[]
  private readonly staged = new Map<string, StagedDraft>()
  private saving = false
  private failed = false
  private readonly listeners = new Set<() => void>()
  readonly store: SnapshotStore<ShiftRouterCardState>

  constructor(scope: SettingsScope<unknown>, fields: readonly CardField[] = CARD_FIELDS) {
    this.scope = scope
    this.fields = fields
    this.store = createSnapshotStore(this.projection())
    this.scope.subscribe(() => this.publish())
  }

  private snapshot(): SettingsScopeSnapshot<unknown> {
    return this.scope.getSnapshot()
  }

  private projection(): ShiftRouterCardState {
    const snap = this.snapshot()
    const plan = buildPlan(this.fields, this.staged, snap)
    return {
      available: snap.status === 'ready',
      writable: snap.writable,
      dirty: plan.patches.length > 0 || plan.invalid,
      invalid: plan.invalid,
      saving: this.saving,
      failed: this.failed,
      fields: this.fields.map((field) => this.fieldState(field)),
    }
  }

  private fieldState(field: CardField): FieldState {
    const snap = this.snapshot()
    const staged = this.staged.get(field.path)
    const effective = readPath(snap.value, field.path)
    const stored = hasPath(snap.user, field.path)
    if (staged === undefined) {
      return { path: field.path, text: formatValue(effective, field), overridden: stored, invalid: false }
    }
    const parsed = staged.clear ? { kind: 'clear' as const } : parseDraft(staged.text, field)
    return {
      path: field.path,
      text: staged.text,
      overridden: !staged.clear && parsed?.kind === 'set',
      invalid: parsed === undefined,
    }
  }

  private publish(): void {
    this.store.set(this.projection())
    for (const listener of this.listeners) listener()
  }

  /** Stage one control's text. */
  edit(field: string, text: string): void {
    this.staged.set(field, { text, clear: false })
    this.publish()
  }

  /** Stage a clear: the field re-inherits the composition layer. */
  resetField(fieldPath: string): void {
    const field = this.fields.find((candidate) => candidate.path === fieldPath)
    if (field === undefined) return
    const base = readPath(this.snapshot().base, field.path)
    this.staged.set(fieldPath, { text: formatValue(base, field), clear: true })
    this.publish()
  }

  /**
   * Write every staged edit, then re-seed from what the scope accepted.
   * Drafts survive a failed save so the user can correct them.
   */
  async save(): Promise<void> {
    const plan = buildPlan(this.fields, this.staged, this.snapshot())
    if (plan.invalid || plan.patches.length === 0 || this.saving) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const patch of plan.patches) {
      if (!(await this.applyPatch(patch))) landed = false
    }
    if (landed) this.staged.clear()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  private async applyPatch(patch: SectionPatch): Promise<boolean> {
    if (patch.op === 'unset') {
      await this.scope.unset(patch.section)
    } else {
      await this.scope.set(patch.section, patch.value)
    }
    // The Host is the only authority on acceptance: verify the read-back user
    // layer holds exactly the leaves this patch wrote.
    const user = this.snapshot().user
    if (patch.op === 'unset') {
      return patch.leaves.every((leaf) => !hasPath(user, `${patch.section}.${leaf.key}`))
    }
    return patch.leaves.every((leaf) => deepEqual(readPath(user, `${patch.section}.${leaf.key}`), leaf.value))
  }

  discard(): void {
    if (this.staged.size === 0 && !this.failed) return
    this.staged.clear()
    this.failed = false
    this.publish()
  }

  /** The face a slot registration injects. */
  inject(): ShiftRouterCardFace {
    return {
      hooks: { shiftRouterCard: this.store },
      edit: (field, text) => this.edit(field, text),
      resetField: (field) => this.resetField(field),
      save: () => this.save(),
      discard: () => this.discard(),
    }
  }
}
