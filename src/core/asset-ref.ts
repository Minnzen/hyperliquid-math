import { exactPlainObject, issue, ownDataValue, type ValidationIssue } from './validation.js'

/**
 * Canonical reference to one perp market, mirroring the official protocol identity:
 * `dex` is the official builder-dex name from `perpDexs` (`null` for the first-party dex),
 * and `index` is the market's position in that dex's `meta.universe`.
 *
 * @public
 */
export interface CanonicalPerpAssetRef {
  readonly network: 'mainnet' | 'testnet'
  readonly marketKind: 'perp'
  readonly dex: string | null
  readonly index: number
}

const assetRefKeys = ['network', 'marketKind', 'dex', 'index'] as const
const unescapedRfc3986 = /[!'()*]/g

export function encodeRfc3986Component(value: string): string {
  return encodeURIComponent(value).replace(
    unescapedRfc3986,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

export function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index)
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return true
  }

  return false
}

export function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

export function derivePerpAssetKey(ref: CanonicalPerpAssetRef): string {
  const encodedDex = ref.dex === null ? '' : encodeRfc3986Component(ref.dex)
  return `hl:${ref.network}:perp:${encodedDex}:${ref.index}`
}

export function normalizePerpAssetRefAt(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly value: CanonicalPerpAssetRef; readonly assetKey: string }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, assetRefKeys, path)
  if (!shape.ok) return shape

  const network = ownDataValue(shape.object, 'network')
  if (network !== 'mainnet' && network !== 'testnet') {
    return {
      ok: false,
      issue: issue('invalid-network', `${path}/network`, network, 'mainnet or testnet'),
    }
  }

  const marketKind = ownDataValue(shape.object, 'marketKind')
  if (marketKind !== 'perp') {
    return {
      ok: false,
      issue: issue('invalid-market-kind', `${path}/marketKind`, marketKind, 'perp'),
    }
  }

  const rawDex = ownDataValue(shape.object, 'dex')
  if (rawDex !== null && typeof rawDex !== 'string') {
    return {
      ok: false,
      issue: issue(
        'invalid-dex',
        `${path}/dex`,
        rawDex,
        'official dex name string, or null for the first-party dex',
      ),
    }
  }
  const dex = rawDex === '' ? null : rawDex
  if (
    dex !== null &&
    (dex.normalize('NFC') !== dex || !isWellFormedUnicode(dex) || hasControlCharacter(dex))
  ) {
    return {
      ok: false,
      issue: issue(
        'invalid-dex',
        `${path}/dex`,
        rawDex,
        'well-formed NFC string without control characters',
      ),
    }
  }

  const index = ownDataValue(shape.object, 'index')
  if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) {
    return {
      ok: false,
      issue: issue('invalid-index', `${path}/index`, index, 'non-negative safe integer'),
    }
  }

  const value: CanonicalPerpAssetRef = { network, marketKind, dex, index }
  return { ok: true, value, assetKey: derivePerpAssetKey(value) }
}
