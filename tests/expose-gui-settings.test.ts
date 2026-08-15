/**
 * dsh-shift-router — GUI whitelist patch logic tests
 *
 * `scripts/expose-gui-settings.mjs` patches the upstream apiproxy
 * `WEB_SETTINGS_NAMESPACES` whitelist so the browser can read/write the
 * `shift-router` settings namespace. The patch must stay syntactically valid
 * across the array forms upstream ships (trailing comma or not).
 */

import { describe, expect, it } from 'vitest'
import { GUI_SETTINGS_NAMESPACE, patchWhitelist } from '../scripts/expose-gui-settings.mjs'

const HEADER = `/** doc */\n`
const FOOTER = `\n/** next */\nconst SESSION_SEARCH_PROVIDER_CALL_LIMIT = 100;\n`

function arrayLiteral(entries: string[], trailingComma = false): string {
  return `const WEB_SETTINGS_NAMESPACES = [\n${entries.map((e) => `\t"${e}"`).join(',\n')}${trailingComma ? ',' : ''}\n];`
}

describe('patchWhitelist', () => {
  it('adds the namespace after the opening bracket (valid with and without trailing comma)', () => {
    for (const trailingComma of [false, true]) {
      const source = HEADER + arrayLiteral(['agent-loop', 'shell', 'web-search-deepseek'], trailingComma) + FOOTER
      const { source: next, changed } = patchWhitelist(source)
      expect(changed).toBe(true)
      expect(next).toContain(`"${GUI_SETTINGS_NAMESPACE}"`)
      // The result must remain a syntactically valid JS array literal.
      expect(() => new Function(next)).not.toThrow()
      expect(next).toContain('"agent-loop"')
    }
  })

  it('is idempotent', () => {
    const source = HEADER + arrayLiteral(['agent-loop', GUI_SETTINGS_NAMESPACE, 'shell']) + FOOTER
    const { source: next, changed } = patchWhitelist(source)
    expect(changed).toBe(false)
    expect(next).toBe(source)
  })

  it('throws when the array is missing', () => {
    expect(() => patchWhitelist('const OTHER = []')).toThrow(/WEB_SETTINGS_NAMESPACES not found/)
  })
})
