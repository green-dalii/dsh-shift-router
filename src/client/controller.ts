/**
 * dsh-shift-router — GUI card controller
 *
 * Bridges the `shift-router` settings scope onto a staged form, mirroring the
 * host-plane card architecture of `dsh-client-ui-settings-plugins`: the user
 * types into controls, edits accumulate as drafts, and a save is the single
 * point where drafts become document mutations (per-section, revision-fenced
 * writes through the settings scope). Nothing here writes directly.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CARD_FIELDS,
  buildPlan,
  isFieldVisible,
  deepEqual,
  formatRows,
  formatValue,
  hasPath,
  parseStaged,
  readPath,
  type CardField,
  type ModelRow,
  type SectionPatch,
  type StagedDraft,
} from './form-model.js'
import {
  CATALOG_UNAVAILABLE,
  EMPTY_CATALOG,
  loadModelCatalog,
  type ModelCatalog,
  type ModelCatalogRemote,
} from './model-catalog.js'

/**
 * The settings-scope surface this card uses.
 *
 * Declared narrowly instead of naming one host type, because the two client
 * services that serve a namespace across the supported shells are different
 * types: `SettingsScope` (`ctx.settingsScope`, up to 0.1.5-rc.x) settles its
 * writes with `Promise<void>`, and `ConfigForm` (`ctx.configForms`, 0.2.0-rc.2
 * onward) settles them with `Promise<boolean>`. The card reads neither — it
 * re-reads the Host's accepted user layer and verifies the leaves it wrote (see
 * {@link ShiftRouterCardController.applyPatch}) — so the write result is
 * `unknown` and either implementation satisfies this shape structurally.
 */
export interface CardScope {
  /** @returns the current sync snapshot (stable reference until the next change). */
  getSnapshot(): ConfigFormSnapshot<unknown>
  /**
   * Observe snapshot replacements.
   * @param listener - invoked after each snapshot change.
   * @returns the disposer removing this listener.
   */
  subscribe(listener: () => void): () => void
  /**
   * Queue one field write.
   * @param field - scalar field inside the namespace section.
   * @param value - JSON-shaped value selected by the user.
   * @returns the host's settlement; the card never reads it.
   */
  set(field: string, value: unknown): Promise<unknown>
  /**
   * Queue one field clear, so the field re-inherits the composition layer.
   * @param field - scalar field inside the namespace section.
   * @returns the host's settlement; the card never reads it.
   */
  unset(field: string): Promise<unknown>
}

/** One field's rendered state: the control's text or rows and its override marker. */
export interface FieldState {
  path: string
  kind: 'scalar' | 'models'
  /** Scalar controls: the draft text. */
  text: string
  /** Model-chain controls: the draft rows. */
  rows: ModelRow[]
  /** Whether a save of the current draft would leave an override. */
  overridden: boolean
  /** Whether the current draft is not a value the field accepts. */
  invalid: boolean
}

/** The card's published snapshot (the store the slot entry injects). */
export interface ShiftRouterCardState {
  /** True when the scope is ready; false when it is loading or unavailable. */
  available: boolean
  /** True when the scope is ready AND writable (the host accepts writes). */
  writable: boolean
  /** True when no settings service exists on this host — render a notice instead of a form. */
  unavailable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
  fields: FieldState[]
  /** The deployment's configured model catalog (dropdown sources). */
  catalog: ModelCatalog
}

/** The face the slot registration injects into the card component. */
export interface ShiftRouterCardFace {
  hooks: {
    shiftRouterCard: SnapshotStore<ShiftRouterCardState>
  }
  /** Stage one scalar control's text. */
  edit(field: string, text: string): void
  /** Stage a model chain's rows. */
  editRows(field: string, rows: ModelRow[]): void
  resetField(field: string): void
  save(): Promise<void>
  discard(): void
}

/** Bridges one `shift-router` scope onto a staged form and its store. */
export class ShiftRouterCardController {
  private readonly scope: CardScope
  private readonly fields: readonly CardField[]
  private readonly staged = new Map<string, StagedDraft>()
  private catalog: ModelCatalog = EMPTY_CATALOG
  private source: ModelCatalogRemote | undefined
  private saving = false
  private failed = false
  private readonly listeners = new Set<() => void>()
  readonly store: SnapshotStore<ShiftRouterCardState>

  constructor(
    scope: CardScope,
    fields: readonly CardField[] = CARD_FIELDS,
  ) {
    this.scope = scope
    this.fields = fields
    this.store = createSnapshotStore(this.projection())
    this.scope.subscribe(() => this.publish())
  }

  /**
   * Attach (or detach) the Host model catalog and read it.
   *
   * The remote is a reactive dependency: the card is mounted before the client
   * assembly may have provided it, and a composition that never does keeps a
   * usable card — manual entry with a stated reason, never an empty dropdown
   * (SPEC §12.2).
   * @param source - the remote face, or undefined when the service is absent.
   */
  attachCatalog(source: ModelCatalogRemote | undefined): void {
    this.source = source
    this.catalog = source === undefined
      ? { ...EMPTY_CATALOG, status: 'failed', error: CATALOG_UNAVAILABLE }
      : EMPTY_CATALOG
    this.publish()
    if (source !== undefined) void this.refreshCatalog()
  }

  /** Re-read the catalog (called when the Host's model inputs may have changed). */
  async refreshCatalog(): Promise<void> {
    const source = this.source
    if (source === undefined) return
    this.catalog = await loadModelCatalog(source)
    this.publish()
  }

  private snapshot(): ConfigFormSnapshot<unknown> {
    return this.scope.getSnapshot()
  }

  /**
   * What a control currently displays: a staged edit wins over the stored value,
   * which is what makes a mode change reveal its sub-form before a save.
   *
   * Scalar-only by design — a condition names an enum (SPEC §6.4), and asking a
   * model chain for "its value" has no answer.
   */
  private displayedValue(path: string, snap: ConfigFormSnapshot<unknown>): unknown {
    const field = this.fields.find((candidate) => candidate.path === path)
    if (field === undefined || field.type === 'models') return undefined
    const staged = this.staged.get(path)
    if (staged !== undefined) return staged.text ?? ''
    return formatValue(readPath(snap.value, path), field)
  }

  /**
   * The controls that are relevant right now (SPEC §12.3).
   *
   * Both readers of the form go through here — the projection the card renders
   * and the plan a save applies — so a control the user cannot see can never be
   * written by a save they pressed for something else.
   */
  private visibleFields(snap: ConfigFormSnapshot<unknown>): readonly CardField[] {
    return this.fields.filter((field) => isFieldVisible(field, (path) => this.displayedValue(path, snap)))
  }

  private projection(): ShiftRouterCardState {
    const snap = this.snapshot()
    const fields = this.visibleFields(snap)
    const plan = buildPlan(fields, this.staged, snap)
    return {
      available: snap.status === 'ready',
      writable: snap.status === 'ready' && snap.writable,
      unavailable: snap.status === 'unavailable',
      dirty: plan.patches.length > 0 || plan.invalid,
      invalid: plan.invalid,
      saving: this.saving,
      failed: this.failed,
      fields: fields.map((field) => this.fieldState(field)),
      catalog: this.catalog,
    }
  }

  private fieldState(field: CardField): FieldState {
    const snap = this.snapshot()
    const staged = this.staged.get(field.path)
    const stored = hasPath(snap.user, field.path)
    if (field.type === 'models') {
      if (staged === undefined) {
        return {
          path: field.path,
          kind: 'models',
          text: '',
          rows: formatRows(readPath(snap.value, field.path)),
          overridden: stored,
          invalid: false,
        }
      }
      const parsed = parseStaged(field, staged)
      return {
        path: field.path,
        kind: 'models',
        text: '',
        rows: staged.rows ?? [],
        overridden: parsed?.kind === 'set',
        invalid: parsed === undefined,
      }
    }
    if (staged === undefined) {
      return {
        path: field.path,
        kind: 'scalar',
        text: formatValue(readPath(snap.value, field.path), field),
        rows: [],
        overridden: stored,
        invalid: false,
      }
    }
    const parsed = parseStaged(field, staged)
    return {
      path: field.path,
      kind: 'scalar',
      text: staged.text ?? '',
      rows: [],
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

  /** Stage a model chain's rows. */
  editRows(field: string, rows: ModelRow[]): void {
    this.staged.set(field, { rows, clear: false })
    this.publish()
  }

  /** Stage a clear: the field re-inherits the composition layer. */
  resetField(fieldPath: string): void {
    const field = this.fields.find((candidate) => candidate.path === fieldPath)
    if (field === undefined) return
    const base = readPath(this.snapshot().base, field.path)
    if (field.type === 'models') {
      this.staged.set(fieldPath, { rows: formatRows(base), clear: true })
    } else {
      this.staged.set(fieldPath, { text: formatValue(base, field), clear: true })
    }
    this.publish()
  }

  /**
   * Write every staged edit, then re-seed from what the scope accepted.
   * Drafts survive a failed save so the user can correct them.
   */
  async save(): Promise<void> {
    const snap = this.snapshot()
    const plan = buildPlan(this.visibleFields(snap), this.staged, snap)
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
      editRows: (field, rows) => this.editRows(field, rows),
      resetField: (field) => this.resetField(field),
      save: () => this.save(),
      discard: () => this.discard(),
    }
  }
}
