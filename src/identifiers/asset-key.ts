import {
  encodeRfc3986Component,
  hasControlCharacter,
  isWellFormedUnicode,
} from '../core/asset-ref.js'
import { invalidInputResult, okResult } from '../core/result.js'
import type { MathIssue, MathResult } from '../model/index.js'
import { issue, normalizePlainShape } from './plain-data.js'
import { assetKeySourceRefs, createIdentifierTrace, reason } from './trace.js'

/** @public */
export interface AssetKeyInput {
  readonly network: 'mainnet' | 'testnet'
  readonly marketKind: 'perp' | 'spot'
  /** Official builder-dex name from `perpDexs`; `null` for the first-party dex (`''` normalizes to `null`). Spot requires `null`. */
  readonly dex: string | null
  /** Market's position in that dex's `meta.universe` (spot: pair index in `spotMeta.universe`). */
  readonly index: number
}

const formulaId = 'hl.identifiers.asset-key.derive'
const expectedShape =
  'plain object with exactly network, marketKind, dex, and index own data fields'
function invalidResult<T>(issue: MathIssue, normalizedInputs = {}): MathResult<T> {
  return invalidInputResult(
    [issue],
    createIdentifierTrace({
      formulaId,
      completion: { status: 'incomplete', reason: reason(issue.code, issue.path as string) },
      normalizedInputs,
      sourceRefs: assetKeySourceRefs,
    }),
  )
}

function validateInput(
  input: unknown,
):
  | { readonly ok: true; readonly value: AssetKeyInput }
  | { readonly ok: false; readonly issue: MathIssue } {
  const shape = normalizePlainShape<AssetKeyInput>(
    input,
    ['network', 'marketKind', 'dex', 'index'],
    expectedShape,
  )
  if (!shape.ok) return shape

  const network = shape.descriptors.network.value
  const marketKind = shape.descriptors.marketKind.value
  const dex = shape.descriptors.dex.value
  const index = shape.descriptors.index.value

  if (network !== 'mainnet' && network !== 'testnet') {
    return { ok: false, issue: issue('invalid-network', '/network', network, 'mainnet or testnet') }
  }
  if (marketKind !== 'perp' && marketKind !== 'spot') {
    return {
      ok: false,
      issue: issue('invalid-market-kind', '/marketKind', marketKind, 'perp or spot'),
    }
  }
  if (dex !== null && typeof dex !== 'string') {
    return {
      ok: false,
      issue: issue(
        'invalid-dex',
        '/dex',
        dex,
        'official dex name string, or null for the first-party dex',
      ),
    }
  }
  const normalizedDex = dex === '' ? null : dex
  if (normalizedDex !== null) {
    if (marketKind === 'spot') {
      return {
        ok: false,
        issue: issue('invalid-dex', '/dex', dex, 'null (the spot universe has no builder dex)'),
      }
    }
    if (normalizedDex.normalize('NFC') !== normalizedDex) {
      return { ok: false, issue: issue('invalid-dex', '/dex', dex, 'Unicode NFC') }
    }
    if (!isWellFormedUnicode(normalizedDex)) {
      return {
        ok: false,
        issue: issue('invalid-dex', '/dex', dex, 'well-formed Unicode'),
      }
    }
    if (hasControlCharacter(normalizedDex)) {
      return {
        ok: false,
        issue: issue('invalid-dex', '/dex', dex, 'no C0 or C1 control characters'),
      }
    }
  }
  if (!Number.isSafeInteger(index) || index < 0) {
    return {
      ok: false,
      issue: issue('invalid-index', '/index', index, 'non-negative safe integer'),
    }
  }

  return { ok: true, value: { network, marketKind, dex: normalizedDex, index } }
}

/**
 * Derives the Math-owned canonical join key `hl:<network>:<marketKind>:<encoded-dex>:<index>`,
 * where a `null` dex encodes as an empty segment (`hl:mainnet:perp::0` is first-party perp 0) and
 * non-null dex names are RFC 3986 component-encoded (UTF-8, uppercase hex). Use it to match rows
 * across inputs within one call; coin/display names and SDK wire mappings stay outside Math.
 *
 * @public
 */
export function deriveCanonicalAssetKey(input: AssetKeyInput): MathResult<string> {
  const validated = validateInput(input)
  if (!validated.ok) return invalidResult(validated.issue)

  const normalized = validated.value
  const normalizedInputs = {
    network: normalized.network,
    marketKind: normalized.marketKind,
    dex: normalized.dex,
    index: normalized.index,
  }
  const encodedDex = normalized.dex === null ? '' : encodeRfc3986Component(normalized.dex)
  const key = `hl:${normalized.network}:${normalized.marketKind}:${encodedDex}:${normalized.index}`

  return okResult(
    key,
    createIdentifierTrace({
      formulaId,
      completion: { status: 'complete' },
      normalizedInputs,
      intermediates: [
        {
          stepId: 'encode-dex',
          inputs: { dex: normalized.dex },
          output: encodedDex,
        },
        { stepId: 'join-asset-key', output: key },
      ],
      sourceRefs: assetKeySourceRefs,
    }),
  )
}
