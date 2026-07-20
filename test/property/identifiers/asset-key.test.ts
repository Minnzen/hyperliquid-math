import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { deriveCanonicalAssetKey } from '../../../src/identifiers/index.js'

describe('canonical asset key properties', () => {
  it('uses uppercase percent encoding and never leaves raw reserved delimiters in dex names', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((dex) => {
          return dex.normalize('NFC') === dex && !hasControlCharacter(dex)
        }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (dex, index) => {
          const result = deriveCanonicalAssetKey({
            network: 'testnet',
            marketKind: 'perp',
            dex,
            index,
          })

          expect(result.value.status).toBe('ok')
          if (result.value.status !== 'ok') return

          const encodedDex = result.value.data.split(':')[3]
          expect(encodedDex).toBeDefined()
          if (encodedDex === undefined) return

          const reservedDelimiters = "/:?#[]@!$&'()*+,;= "
          expect([...reservedDelimiters].some((delimiter) => encodedDex.includes(delimiter))).toBe(
            false,
          )
          for (const [escapeSequence] of encodedDex.matchAll(/%[0-9A-Fa-f]{2}/gu)) {
            expect(escapeSequence).toBe(escapeSequence.toUpperCase())
          }
          expect(decodeURIComponent(encodedDex)).toBe(dex)
        },
      ),
      { numRuns: 500 },
    )
  })
})

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index)
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true
  }

  return false
}
