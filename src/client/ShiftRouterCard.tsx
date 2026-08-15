/**
 * dsh-shift-router — GUI settings card
 *
 * One card inside the Settings → Plugins → Plugin configuration section. It
 * edits the `shift-router` settings namespace: scalar leaves and the two tier
 * model chains are staged as drafts and written on save (see `controller.ts`
 * / `form-model.ts`). The section host (`dsh-client-ui-settings-plugins`)
 * stacks whatever cards register into the `settings.plugin.item` slot and
 * supplies the Save/Discard chrome contract; this card draws its own body
 * with the same DSW design tokens and interaction states as the host-plane
 * cards.
 *
 * Layout: one settings row per scalar field — label + hint on the left,
 * control right-aligned on the same line (the classic settings-form pattern)
 * — so a field costs one compact row instead of three stacked lines. Complex
 * fields (the tier model chains) render as a full-width block under their
 * label row. Sections are bordered groups with a title, an optional one-line
 * summary, and sub-group labels for the routing section.
 */

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { CARD_FIELDS, CARD_SECTIONS, type CardField, type ModelRow } from './form-model.js'
import type { FieldState, ShiftRouterCardFace } from './controller.js'
import type { CatalogEntry, ModelCatalog } from './model-catalog.js'
import type { ShiftRouterCardKey } from './locales.js'

/** Composed props the section host injects into this card. */
export type ShiftRouterCardProps = PropsRuntime<'settings.plugin.item'> &
  PropsLocale<'shift-router'> &
  InjectFace<ShiftRouterCardFace>

// ─── Injected stylesheet ─────────────────────────────────────────────
// Hover/focus/disabled states cannot be expressed with inline styles. The
// host-plane packages ship the same way: a scoped <style> tag added once at
// load, keyed by a data attribute so HMR reloads do not duplicate it.

const STYLE_ID = 'dsh-shift-router/card.css'
const CARD_CSS = `
.sr-card{transition:border-color .16s,background .16s}
.sr-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.sr-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.sr-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.sr-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.sr-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.sr-select{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12' fill='none'%3E%3Cpath d='M3 4.5L6 7.5L9 4.5' stroke='%2381858C' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-position:right 12px center;background-repeat:no-repeat;background-size:12px 12px;padding-right:32px;cursor:pointer}
.sr-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.sr-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.sr-discard:disabled,.sr-save:disabled{opacity:.4;cursor:default}
.sr-discard:focus-visible,.sr-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sr-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.sr-iconBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.sr-field+.sr-field{border-top:1px solid var(--dsw-alias-border-l2)}
.sr-addModel:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.sr-iconBtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.sr-iconBtnDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.sr-hint{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
`

if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) === null) {
  const tag = document.createElement('style')
  tag.dataset.pluginCss = STYLE_ID
  tag.textContent = CARD_CSS
  document.head.appendChild(tag)
}

// ─── Design tokens (DSW aliases used by the host-plane cards) ──────────
const card: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-3)',
  borderRadius: 12,
  listStyle: 'none',
  margin: 0,
}
const header: CSSProperties = {
  appearance: 'none',
  width: '100%',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  background: 'transparent',
  border: 0,
  borderRadius: 12,
  alignItems: 'center',
  gap: 12,
  padding: '14px 16px',
  display: 'flex',
}
const headText: CSSProperties = {
  flexDirection: 'column',
  flex: 1,
  gap: 4,
  minWidth: 0,
  display: 'flex',
}
const name: CSSProperties = {
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 15,
  fontWeight: 600,
  lineHeight: 1.35,
}
const description: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 13,
  lineHeight: 1.4,
}
const chevron: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  flex: 'none',
  display: 'inline-flex',
  transition: 'transform .16s',
}
const pending: CSSProperties = {
  whiteSpace: 'nowrap',
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-secondary)',
  borderRadius: 999,
  flex: 'none',
  padding: '1px 8px',
  fontSize: 11,
  fontWeight: 500,
  lineHeight: 1.3,
}
const body: CSSProperties = {
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  margin: '0 16px',
  paddingBottom: 8,
}
const readOnly: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  margin: '12px 0 0',
  fontSize: 12,
  lineHeight: 1.4,
}

// ── Section blocks ────────────────────────────────────────────────────
const sectionBlock: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l1)',
  borderRadius: 12,
  overflow: 'hidden',
  marginTop: 10,
}
const sectionHead: CSSProperties = {
  flexDirection: 'column',
  gap: 1,
  padding: '8px 14px 4px',
  display: 'flex',
}
const sectionTitle: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  margin: 0,
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.4,
}
const sectionSummary: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  margin: 0,
  fontSize: 12,
  lineHeight: 1.4,
}
const sectionBody: CSSProperties = {
  padding: '0 14px 4px',
}
const groupHeading: CSSProperties = {
  color: 'var(--dsw-alias-label-caption)',
  textTransform: 'uppercase',
  letterSpacing: '.04em',
  margin: '10px 0 0',
  paddingBottom: 2,
  fontSize: 11,
  fontWeight: 500,
  lineHeight: 1.3,
}

// ── One settings row: label + hint left, control right ────────────────
// Vertical rhythm is driven by padding, not line boxes: label/hint use a
// compact unitless line-height (1.35 ≈ the DSW text standard of 1.4–1.5,
// tighter for dense settings rows), and fixed-height controls drop
// line-height entirely (it has no layout effect there).
const fieldRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 16,
  padding: '6px 0',
}
const fieldText: CSSProperties = {
  flexDirection: 'column',
  gap: 1,
  minWidth: 0,
  display: 'flex',
}
const label: CSSProperties = {
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
  fontWeight: 500,
  lineHeight: 1.4,
}
const hint: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  margin: 0,
  fontSize: 12,
  lineHeight: 1.4,
}
const invalidText: CSSProperties = {
  ...hint,
  color: 'var(--dsw-alias-label-error)',
}
const controlCell: CSSProperties = {
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: 10,
  display: 'flex',
}
const badges: CSSProperties = {
  alignItems: 'center',
  gap: 8,
  display: 'inline-flex',
}
const badge: CSSProperties = {
  whiteSpace: 'nowrap',
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-secondary)',
  borderRadius: 999,
  padding: '1px 8px',
  fontSize: 11,
  fontWeight: 500,
  lineHeight: 1.3,
}
const reset: CSSProperties = {
  font: 'inherit',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  padding: 0,
  fontSize: 12,
  lineHeight: 1.3,
}
const input: CSSProperties = {
  boxSizing: 'border-box',
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-3)',
  height: 34,
  width: 180,
  font: 'inherit',
  color: 'var(--dsw-alias-label-primary)',
  borderRadius: 8,
  padding: '0 12px',
  fontSize: 13,
}
const inputInvalid: CSSProperties = {
  ...input,
  borderColor: 'var(--dsw-alias-label-error)',
}
const inputWrap: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
}
const unitSuffix: CSSProperties = {
  position: 'absolute',
  right: 12,
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
  pointerEvents: 'none',
}

// ── Toggle switch (contrast-safe in light and dark themes) ────────────
// OFF: neutral track + white knob (separated by a shadow). ON: the business
// accent — a mid-tone blue in BOTH themes (unlike brand-primary, which is
// near-white in dark mode and would hide a white knob). The knob is always
// static white with a drop shadow, so the on/off position reads in either
// theme.
const switchTrack: CSSProperties = {
  boxSizing: 'border-box',
  appearance: 'none',
  width: 36,
  height: 20,
  flex: 'none',
  position: 'relative',
  borderRadius: 999,
  border: '1px solid var(--dsw-alias-border-l3)',
  background: 'var(--dsw-alias-bg-module-platform)',
  cursor: 'pointer',
  padding: 0,
  transition: 'background .16s, border-color .16s',
}
const switchTrackOn: CSSProperties = {
  ...switchTrack,
  background: 'var(--dsw-alias-state-business-primary)',
  borderColor: 'transparent',
}
const switchKnob: CSSProperties = {
  position: 'absolute',
  top: 2,
  left: 2,
  width: 14,
  height: 14,
  borderRadius: '50%',
  background: '#fff',
  boxShadow: '0 1px 2px rgba(15, 23, 42, .3)',
  transition: 'transform .16s',
}
const switchKnobOn: CSSProperties = {
  ...switchKnob,
  transform: 'translateX(16px)',
}

// ── Model-chain editor ────────────────────────────────────────────────
const modelField: CSSProperties = {
  padding: '6px 0',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}
const modelFieldHead: CSSProperties = {
  alignItems: 'center',
  gap: 8,
  display: 'flex',
}
const modelList: CSSProperties = {
  flexDirection: 'column',
  gap: 6,
  display: 'flex',
}
const modelRow: CSSProperties = {
  gridTemplateColumns: '20px minmax(0,1fr) minmax(0,1fr) auto',
  alignItems: 'center',
  gap: 8,
  display: 'grid',
}
const modelIndex: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  textAlign: 'center',
  fontSize: 12,
}
const rowInput: CSSProperties = {
  ...input,
  width: '100%',
  height: 32,
}
const rowInputInvalid: CSSProperties = {
  ...rowInput,
  borderColor: 'var(--dsw-alias-label-error)',
}
const iconBtn: CSSProperties = {
  boxSizing: 'border-box',
  width: 28,
  height: 28,
  color: 'var(--dsw-alias-label-tertiary)',
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  borderRadius: 8,
  justifyContent: 'center',
  alignItems: 'center',
  padding: 0,
  display: 'inline-flex',
}
const addModel: CSSProperties = {
  boxSizing: 'border-box',
  border: '1px solid var(--dsw-alias-border-l2)',
  height: 28,
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  cursor: 'pointer',
  background: 'transparent',
  borderRadius: 14,
  alignSelf: 'flex-start',
  alignItems: 'center',
  gap: 4,
  padding: '0 10px',
  fontSize: 12,
  display: 'inline-flex',
}
const modelEmpty: CSSProperties = {
  border: '1px dashed var(--dsw-alias-border-l3)',
  textAlign: 'center',
  color: 'var(--dsw-alias-label-tertiary)',
  borderRadius: 8,
  padding: '10px 12px',
  margin: 0,
  fontSize: 12,
  lineHeight: 1.4,
}

// ── Footer ────────────────────────────────────────────────────────────
const footer: CSSProperties = {
  borderTop: '1px solid var(--dsw-alias-border-l2)',
  justifyContent: 'flex-end',
  alignItems: 'center',
  gap: 8,
  padding: '12px 0 4px',
  display: 'flex',
}
const failed: CSSProperties = {
  minWidth: 0,
  color: 'var(--dsw-alias-label-error)',
  flex: 1,
  margin: 0,
  fontSize: 12,
  lineHeight: 1.4,
}
const button: CSSProperties = {
  appearance: 'none',
  font: 'inherit',
  cursor: 'pointer',
  border: '1px solid transparent',
  borderRadius: 8,
  padding: '5px 14px',
  fontSize: 13,
  lineHeight: 1.4,
}
const btnDiscard: CSSProperties = {
  ...button,
  borderColor: 'var(--dsw-alias-border-l2)',
  color: 'var(--dsw-alias-label-secondary)',
  background: 'transparent',
}
const btnSave: CSSProperties = {
  ...button,
  background: 'var(--dsw-alias-label-primary)',
  color: 'var(--dsw-alias-bg-layer-3)',
}

/** The chevron icon used by the host-plane plugin cards (DSW chevron-down-14). */
function ChevronIcon(): ReactNode {
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

/**
 * Render one plugin card editing the shift-router settings.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card, or nothing while the namespace is unavailable.
 */
export function ShiftRouterCard(props: ShiftRouterCardProps): ReactNode {
  const { t, edit, editRows, resetField, save, discard } = props
  const state = props.useShiftRouterCard((snapshot) => snapshot)
  const [open, setOpen] = useState(false)
  if (!state.available) return null

  const stateByPath = new Map(state.fields.map((field) => [field.path, field]))
  const blocked = !state.dirty || state.invalid || state.saving

  return (
    <li style={card} className={open ? 'sr-card sr-cardOpen' : 'sr-card'}>
      <button
        type="button"
        className="sr-header"
        style={header}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
        onClick={() => setOpen(!open)}
      >
        <span style={headText}>
          <span style={name}>{t('title')}</span>
          <span style={description}>{t('description')}</span>
        </span>
        {state.dirty ? <span style={pending}>{t('unsaved')}</span> : null}
        <span style={{ ...chevron, transform: open ? 'rotate(180deg)' : undefined }}>
          <ChevronIcon />
        </span>
      </button>
      {open ? (
        <div style={body}>
          {!state.writable ? (
            <p style={readOnly} role="status">{t('readOnly')}</p>
          ) : null}
          {CARD_SECTIONS.map((section) => {
            const sectionFields = CARD_FIELDS.filter((field) => field.display === section.id)
            if (sectionFields.length === 0) return null
            return (
              <section key={section.id} style={sectionBlock}>
                <header style={sectionHead}>
                  <h3 style={sectionTitle}>{t(section.labelKey as ShiftRouterCardKey)}</h3>
                  {section.summaryKey ? (
                    <p style={sectionSummary}>{t(section.summaryKey as ShiftRouterCardKey)}</p>
                  ) : null}
                </header>
                <div style={sectionBody}>
                  <SectionFields
                    fields={sectionFields}
                    stateByPath={stateByPath}
                    catalog={state.catalog}
                    t={t}
                    disabled={!state.writable}
                    edit={edit}
                    editRows={editRows}
                    resetField={resetField}
                  />
                </div>
              </section>
            )
          })}
          <div style={footer}>
            {state.failed ? <p style={failed} role="status">{t('saveFailed')}</p> : null}
            <button type="button" className="sr-discard" style={btnDiscard} disabled={!state.dirty || state.saving} onClick={discard}>
              {t('discard')}
            </button>
            <button type="button" className="sr-save" style={btnSave} disabled={blocked} onClick={() => void save()}>
              {t(state.saving ? 'saving' : 'save')}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

interface SectionFieldsProps {
  fields: readonly CardField[]
  stateByPath: Map<string, FieldState | undefined>
  catalog: ModelCatalog
  t: Translate<ShiftRouterCardKey>
  disabled: boolean
  edit: (field: string, text: string) => void
  editRows: (field: string, rows: ModelRow[]) => void
  resetField: (field: string) => void
}

/** A section's fields, split into ungrouped fields then sub-group blocks. */
function SectionFields(props: SectionFieldsProps): ReactNode {
  const { fields, ...rest } = props
  const ungrouped = fields.filter((field) => field.group === undefined)
  const groups: string[] = []
  for (const field of fields) {
    if (field.group !== undefined && !groups.includes(field.group)) groups.push(field.group)
  }
  return (
    <>
      {ungrouped.map((field) => <FieldRow key={field.path} field={field} {...rest} />)}
      {groups.map((group) => (
        <div key={group}>
          <h4 style={groupHeading}>{rest.t(group as ShiftRouterCardKey)}</h4>
          {fields.filter((field) => field.group === group).map((field) => (
            <FieldRow key={field.path} field={field} {...rest} />
          ))}
        </div>
      ))}
    </>
  )
}

interface FieldRowProps extends Omit<SectionFieldsProps, 'fields'> {
  field: CardField
}

/** One labelled control: label + hint on the left, control right-aligned. */
function FieldRow(props: FieldRowProps): ReactNode {
  const { field, stateByPath, t, disabled, edit, editRows, resetField } = props
  const fieldState = stateByPath.get(field.path)
  const overridden = fieldState?.overridden ?? false
  const invalid = fieldState?.invalid ?? false
  const id = `shift-router-${field.path.replaceAll('.', '-')}`

  if (field.type === 'models') {
    return (
      <div className="sr-field" style={modelField}>
        <div style={modelFieldHead}>
          <label style={label} htmlFor={id}>{t(field.labelKey as ShiftRouterCardKey)}</label>
          {overridden ? (
            <span style={badges}>
              <span style={badge}>{t('overridden')}</span>
              <button type="button" className="sr-reset" style={reset} disabled={disabled} onClick={() => resetField(field.path)}>
                {t('reset')}
              </button>
            </span>
          ) : null}
        </div>
        <ModelEditor field={field} fieldState={fieldState} catalog={props.catalog} t={t} disabled={disabled} editRows={editRows} />
        <p
          className="sr-hint"
          style={hint}
          title={t(field.hintKey as ShiftRouterCardKey)}
        >
          {t(field.hintKey as ShiftRouterCardKey)}
        </p>
      </div>
    )
  }

  let control: ReactNode
  if (field.type === 'boolean') {
    const checked = (fieldState?.text ?? '') === 'true'
    control = (
      <button
        id={id}
        type="button"
        role="switch"
        className="sr-switch"
        style={checked ? switchTrackOn : switchTrack}
        aria-checked={checked}
        aria-label={t(field.labelKey as ShiftRouterCardKey)}
        disabled={disabled}
        onClick={() => edit(field.path, checked ? 'false' : 'true')}
      >
        <span style={checked ? switchKnobOn : switchKnob} />
      </button>
    )
  } else if (field.type === 'enum') {
    const text = fieldState?.text ?? ''
    control = (
      <select
        id={id}
        className="sr-select sr-input"
        style={input}
        value={text}
        disabled={disabled}
        onChange={(event) => edit(field.path, event.target.value)}
      >
        {field.enum?.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    )
  } else {
    const text = fieldState?.text ?? ''
    const width = field.unit ? 150 : 180
    const controlStyle: CSSProperties = field.unit
      ? { ...(invalid ? inputInvalid : input), width, paddingRight: 54 }
      : { ...(invalid ? inputInvalid : input), width }
    control = (
      <div style={inputWrap}>
        <input
          id={id}
          className="sr-input"
          type="text"
          inputMode="numeric"
          style={controlStyle}
          value={text}
          placeholder={t('invalidNumber')}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onChange={(event) => edit(field.path, event.target.value)}
        />
        {field.unit ? <span style={unitSuffix}>{field.unit}</span> : null}
      </div>
    )
  }

  return (
    <div className="sr-field" style={fieldRow}>
      <div style={fieldText}>
        <span style={label}>{t(field.labelKey as ShiftRouterCardKey)}</span>
        <p
          className={invalid ? undefined : 'sr-hint'}
          style={invalid ? invalidText : hint}
          title={invalid ? undefined : t(field.hintKey as ShiftRouterCardKey)}
        >
          {invalid
            ? t('invalidNumber')
            : t(field.hintKey as ShiftRouterCardKey)}
        </p>
      </div>
      <div style={controlCell}>
        {overridden ? (
          <span style={badges}>
            <span style={badge}>{t('overridden')}</span>
            <button type="button" className="sr-reset" style={reset} disabled={disabled} onClick={() => resetField(field.path)}>
              {t('reset')}
            </button>
          </span>
        ) : null}
        {control}
      </div>
    </div>
  )
}

interface ModelEditorProps {
  field: CardField
  fieldState: FieldState | undefined
  catalog: ModelCatalog
  t: Translate<ShiftRouterCardKey>
  disabled: boolean
  editRows: (field: string, rows: ModelRow[]) => void
}

/** Sentinel value of the "Custom…" option in the provider/model selects. */
const CUSTOM = '__shift-router-custom__'

/** Select options: the catalog entries, the current value when it is not listed, then a blank placeholder when empty. */
function catalogOptions(
  entries: readonly CatalogEntry[],
  current: string,
  placeholder: string,
  t: Translate<ShiftRouterCardKey>,
): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = []
  if (current === '') {
    out.push({ value: '', label: placeholder })
  } else if (!entries.some((entry) => entry.id === current)) {
    out.push({ value: current, label: `${current} (${t('modelCurrent')})` })
  }
  for (const entry of entries) {
    out.push({ value: entry.id, label: entry.name === entry.id ? entry.id : `${entry.name} (${entry.id})` })
  }
  return out
}

/**
 * The tier model-chain editor: ordered rows of provider/model with add/remove.
 *
 * Provider and model are dropdowns sourced from the deployment's configured
 * model catalog (`api.llm.models`); picking "Custom…" swaps the control for a
 * free-text input. While the catalog loads or after a failure, rows fall back
 * to free-text inputs so configuration never blocks.
 */
function ModelEditor(props: ModelEditorProps): ReactNode {
  const { field, fieldState, catalog, t, disabled, editRows } = props
  const rows = fieldState?.rows ?? []
  const invalid = fieldState?.invalid ?? false
  const [customProvider, setCustomProvider] = useState<Set<number>>(new Set())
  const [customModel, setCustomModel] = useState<Set<number>>(new Set())
  const catalogReady = catalog.status === 'ready'

  const updateRow = (index: number, patch: Partial<ModelRow>): void => {
    editRows(field.path, rows.map((row, i) => i === index ? { ...row, ...patch } : row))
  }
  const removeRow = (index: number): void => {
    editRows(field.path, rows.filter((_, i) => i !== index))
  }
  const addRow = (): void => {
    editRows(field.path, [...rows, { provider: '', model: '', priority: rows.length + 1 }])
  }
  const toggleCustom = (setter: (updater: (prev: Set<number>) => Set<number>) => void, index: number): void => {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  return (
    <div style={{ flexDirection: 'column', gap: 8, display: 'flex' }}>
      {rows.length > 0 ? (
        <div style={modelList}>
          {rows.map((row, index) => {
            const providerSelect = catalogReady && !customProvider.has(index)
            const providerModels = catalog.modelsByProvider[row.provider] ?? []
            const modelSelect = catalogReady && !customModel.has(index) && providerModels.length > 0
            return (
              <div key={index} style={modelRow}>
                <span style={modelIndex}>{index + 1}</span>
                {providerSelect ? (
                  <select
                    className="sr-select sr-input"
                    style={rowInput}
                    value={row.provider}
                    disabled={disabled}
                    aria-label={`${t(field.labelKey as ShiftRouterCardKey)} ${index + 1} ${t('modelProvider')}`}
                    onChange={(event) => {
                      if (event.target.value === CUSTOM) toggleCustom(setCustomProvider, index)
                      else updateRow(index, { provider: event.target.value })
                    }}
                  >
                    {catalogOptions(catalog.providers, row.provider, t('modelProvider'), t).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                    <option value={CUSTOM}>{t('modelCustom')}</option>
                  </select>
                ) : (
                  <input
                    className="sr-input"
                    style={rowInput}
                    value={row.provider}
                    placeholder={t('modelProvider')}
                    disabled={disabled}
                    aria-label={`${t(field.labelKey as ShiftRouterCardKey)} ${index + 1} ${t('modelProvider')}`}
                    onChange={(event) => updateRow(index, { provider: event.target.value })}
                  />
                )}
                {modelSelect ? (
                  <select
                    className="sr-select sr-input"
                    style={invalid ? rowInputInvalid : rowInput}
                    value={row.model}
                    disabled={disabled}
                    aria-label={`${t(field.labelKey as ShiftRouterCardKey)} ${index + 1} ${t('modelName')}`}
                    onChange={(event) => {
                      if (event.target.value === CUSTOM) toggleCustom(setCustomModel, index)
                      else updateRow(index, { model: event.target.value })
                    }}
                  >
                    {catalogOptions(providerModels, row.model, t('modelName'), t).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                    <option value={CUSTOM}>{t('modelCustom')}</option>
                  </select>
                ) : (
                  <input
                    className="sr-input"
                    style={invalid ? rowInputInvalid : rowInput}
                    value={row.model}
                    placeholder={t('modelName')}
                    disabled={disabled}
                    aria-label={`${t(field.labelKey as ShiftRouterCardKey)} ${index + 1} ${t('modelName')}`}
                    onChange={(event) => updateRow(index, { model: event.target.value })}
                  />
                )}
                <button
                  type="button"
                  className="sr-iconBtn sr-iconBtnDanger"
                  style={iconBtn}
                  disabled={disabled}
                  aria-label={t('removeModel')}
                  title={t('removeModel')}
                  onClick={() => removeRow(index)}
                >
                  <svg width={14} height={14} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      ) : (
        <p style={modelEmpty}>{t('noModels')}</p>
      )}
      {catalog.status === 'loading' ? <p style={hint}>{t('modelLoading')}</p> : null}
      {catalog.status === 'failed' ? <p style={hint}>{t('modelCatalogFailed')}</p> : null}
      <button type="button" className="sr-addModel" style={addModel} disabled={disabled} onClick={addRow}>
        <svg width={12} height={12} viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M6 2.5V9.5M2.5 6H9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        {t('addModel')}
      </button>
    </div>
  )
}
