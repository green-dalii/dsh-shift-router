/**
 * dsh-shift-router — GUI settings card
 *
 * One card inside the Settings → Plugins → Plugin configuration section. It
 * edits the `shift-router` settings namespace: scalar leaves staged as drafts
 * and written on save (see `controller.ts` / `form-model.ts`). The section
 * host (`dsh-client-ui-settings-plugins`) stacks whatever cards register into
 * the `settings.plugin.item` slot and supplies the Save/Discard chrome
 * contract; this card draws its own body with the same DSW design tokens.
 */

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { CARD_FIELDS, CARD_SECTIONS, type CardField } from './form-model.js'
import type { FieldState, ShiftRouterCardFace } from './controller.js'
import type { ShiftRouterCardKey } from './locales.js'

/** Composed props the section host injects into this card. */
export type ShiftRouterCardProps = PropsRuntime<'settings.plugin.item'> &
  PropsLocale<'shift-router'> &
  InjectFace<ShiftRouterCardFace>

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
  lineHeight: 1.4,
}
const description: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 13,
  lineHeight: 1.5,
}
const chevron: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  flex: 'none',
  fontSize: 12,
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
  lineHeight: 17,
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
  lineHeight: 1.5,
}
const sectionHeading: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  margin: '14px 0 0',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.04em',
  textTransform: 'uppercase',
  lineHeight: 1.5,
}
const fieldRow: CSSProperties = {
  flexDirection: 'column',
  gap: 6,
  padding: '10px 0',
  display: 'flex',
}
const fieldHead: CSSProperties = {
  alignItems: 'center',
  gap: 8,
  display: 'flex',
}
const label: CSSProperties = {
  minWidth: 0,
  color: 'var(--dsw-alias-label-primary)',
  flex: 1,
  fontSize: 13,
  fontWeight: 500,
  lineHeight: 1.5,
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
  lineHeight: 17,
}
const reset: CSSProperties = {
  font: 'inherit',
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  padding: 0,
  fontSize: 12,
  lineHeight: 1.5,
}
const input: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-3)',
  height: 34,
  font: 'inherit',
  color: 'var(--dsw-alias-label-primary)',
  borderRadius: 8,
  padding: '0 12px',
  fontSize: 13,
  lineHeight: 1.5,
}
const inputInvalid: CSSProperties = {
  ...input,
  borderColor: 'var(--dsw-alias-label-error)',
}
const hint: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  margin: 0,
  fontSize: 12,
  lineHeight: 1.5,
}
const invalidText: CSSProperties = {
  ...hint,
  color: 'var(--dsw-alias-label-error)',
}
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
  lineHeight: 1.5,
}
const button: CSSProperties = {
  appearance: 'none',
  font: 'inherit',
  cursor: 'pointer',
  border: '1px solid transparent',
  borderRadius: 8,
  padding: '5px 14px',
  fontSize: 13,
  lineHeight: 1.5,
}
const btnDiscard: CSSProperties = {
  ...button,
  borderColor: 'var(--dsw-alias-border-l2)',
  color: 'var(--dsw-alias-label-secondary)',
  background: 'transparent',
}
const btnSave: CSSProperties = {
  ...button,
  background: 'var(--dsw-alias-brand-primary)',
  color: '#fff',
}

/**
 * Render one plugin card editing the shift-router settings.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card, or nothing while the namespace is unavailable.
 */
export function ShiftRouterCard(props: ShiftRouterCardProps): ReactNode {
  const { t, edit, resetField, save, discard } = props
  const state = props.useShiftRouterCard((snapshot) => snapshot)
  const [open, setOpen] = useState(false)
  if (!state.available) return null

  const stateByPath = new Map(state.fields.map((field) => [field.path, field]))
  const blocked = !state.dirty || state.invalid || state.saving

  return (
    <li style={card}>
      <button
        type="button"
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
        <span style={{ ...chevron, transform: open ? 'rotate(180deg)' : undefined }}>▾</span>
      </button>
      {open ? (
        <div style={body}>
          {!state.writable ? (
            <p style={readOnly} role="status">{t('readOnly')}</p>
          ) : null}
          {CARD_SECTIONS.map((section) => {
            const sectionFields = CARD_FIELDS.filter((field) => field.section === section.id)
            if (sectionFields.length === 0) return null
            return (
              <div key={section.id}>
                <h4 style={sectionHeading}>{t(section.labelKey as ShiftRouterCardKey)}</h4>
                {sectionFields.map((field) => (
                  <FieldRow
                    key={field.path}
                    field={field}
                    fieldState={stateByPath.get(field.path)}
                    t={t}
                    disabled={!state.writable}
                    edit={edit}
                    resetField={resetField}
                  />
                ))}
              </div>
            )
          })}
          <div style={footer}>
            {state.failed ? <p style={failed} role="status">{t('saveFailed')}</p> : null}
            <button type="button" style={btnDiscard} disabled={!state.dirty || state.saving} onClick={discard}>
              {t('discard')}
            </button>
            <button type="button" style={btnSave} disabled={blocked} onClick={() => void save()}>
              {t(state.saving ? 'saving' : 'save')}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}

interface FieldRowProps {
  field: CardField
  fieldState: FieldState | undefined
  t: Translate<ShiftRouterCardKey>
  disabled: boolean
  edit: (field: string, text: string) => void
  resetField: (field: string) => void
}

/** One labelled control: label, badge/reset, the input, and a hint. */
function FieldRow(props: FieldRowProps): ReactNode {
  const { field, fieldState, t, disabled, edit, resetField } = props
  const text = fieldState?.text ?? ''
  const overridden = fieldState?.overridden ?? false
  const invalid = fieldState?.invalid ?? false
  const id = `shift-router-${field.path.replaceAll('.', '-')}`
  const hintText = field.hint ? `${t(field.hintKey as ShiftRouterCardKey)} (${field.hint})` : t(field.hintKey as ShiftRouterCardKey)

  let control: ReactNode
  if (field.type === 'boolean') {
    control = (
      <input
        id={id}
        type="checkbox"
        checked={text === 'true'}
        disabled={disabled}
        onChange={(event) => edit(field.path, event.target.checked ? 'true' : 'false')}
      />
    )
  } else if (field.type === 'enum') {
    control = (
      <select
        id={id}
        style={input}
        value={text}
        disabled={disabled}
        onChange={(event) => edit(field.path, event.target.value)}
      >
        {field.enum?.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    )
  } else {
    control = (
      <input
        id={id}
        type="text"
        inputMode="numeric"
        style={invalid ? inputInvalid : input}
        value={text}
        placeholder={t('invalidNumber')}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(event) => edit(field.path, event.target.value)}
      />
    )
  }

  return (
    <div style={fieldRow}>
      <div style={fieldHead}>
        <label style={label} htmlFor={id}>{t(field.labelKey as ShiftRouterCardKey)}</label>
        {overridden ? (
          <span style={badges}>
            <span style={badge}>{t('overridden')}</span>
            <button type="button" style={reset} disabled={disabled} onClick={() => resetField(field.path)}>
              {t('reset')}
            </button>
          </span>
        ) : null}
      </div>
      {control}
      <p style={invalid ? invalidText : hint}>{invalid ? t('invalidNumber') : hintText}</p>
    </div>
  )
}
