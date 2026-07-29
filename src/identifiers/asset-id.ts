import { invalidInputResult, okResult } from '../core/result.js'
import type { MathIssue, MathResult } from '../model/index.js'
import { issue, normalizePlainShape } from './plain-data.js'
import { assetIdSourceRefs, createIdentifierTrace, reason } from './trace.js'

/**
 * Metadata index to encode: `index` is the position in the owning dex's `meta.universe`
 * (spot: `spotMeta.universe` pair index); HIP-3 `dexIndex` is the builder-dex index starting at 1.
 *
 * @public
 */
export type AssetIdEncodeInput =
  | { readonly kind: 'perp'; readonly index: number }
  | { readonly kind: 'spot'; readonly index: number }
  | { readonly kind: 'hip3-perp'; readonly dexIndex: number; readonly index: number }
  | { readonly kind: 'outcome'; readonly outcome: number; readonly side: 0 | 1 }

/** @public */
export interface AssetIdDecodeInput {
  /** Numeric protocol asset ID (JSON safe integer), e.g. from order wire payloads. */
  readonly assetId: number
}

/** @public */
export type AssetIdDecodeOutput =
  | { readonly kind: 'perp'; readonly index: number }
  | { readonly kind: 'spot'; readonly index: number }
  | { readonly kind: 'hip3-perp'; readonly dexIndex: number; readonly index: number }
  | { readonly kind: 'outcome'; readonly outcome: number; readonly side: 0 | 1 }

const encodeFormulaId = 'hl.identifiers.asset-id.encode'
const decodeFormulaId = 'hl.identifiers.asset-id.decode'
const expectedDecodeShape =
  'plain object with exactly one own safe integer data field named assetId'

function invalidResult<T>(
  formulaId: string,
  issue: MathIssue,
  normalizedInputs = {},
  maturity: 'stable' | 'experimental' = 'stable',
): MathResult<T> {
  return invalidInputResult(
    [issue],
    createIdentifierTrace({
      formulaId,
      formulaVersion: 2,
      maturity,
      completion: { status: 'incomplete', reason: reason(issue.code, issue.path as string) },
      normalizedInputs,
      sourceRefs: assetIdSourceRefs,
    }),
  )
}

function validateSafeInteger(
  value: unknown,
  path: string,
):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly issue: MathIssue } {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return {
      ok: false,
      issue: issue('invalid-integer', path, value, 'non-negative safe integer'),
    }
  }

  return { ok: true, value }
}

function validateEncodeInput(
  input: unknown,
):
  | { readonly ok: true; readonly value: AssetIdEncodeInput }
  | { readonly ok: false; readonly issue: MathIssue } {
  if (typeof input !== 'object' || input === null) {
    return {
      ok: false,
      issue: issue('invalid-input-shape', '', input, 'plain object'),
    }
  }

  let kind: unknown
  try {
    if (Array.isArray(input)) {
      return {
        ok: false,
        issue: issue('invalid-input-shape', '', 'array', 'plain object'),
      }
    }

    const prototype = Object.getPrototypeOf(input) as object | null
    if (prototype !== Object.prototype && prototype !== null) {
      return {
        ok: false,
        issue: issue('invalid-input-shape', '', 'non-plain-object', 'plain object'),
      }
    }
    const kindDescriptor = Reflect.getOwnPropertyDescriptor(input, 'kind')
    if (
      kindDescriptor === undefined ||
      !Object.hasOwn(kindDescriptor, 'value') ||
      kindDescriptor.enumerable !== true
    ) {
      return {
        ok: false,
        issue: issue('invalid-input-shape', '', 'kind', 'own enumerable kind data field'),
      }
    }
    kind = kindDescriptor.value
  } catch {
    return {
      ok: false,
      issue: issue('invalid-input-shape', '', 'uninspectable-object', 'plain object'),
    }
  }

  if (kind === 'perp' || kind === 'spot') {
    const shape = normalizePlainShape<{ readonly kind: unknown; readonly index: unknown }>(
      input,
      ['kind', 'index'],
      'plain object with exactly kind and index own data fields',
    )
    if (!shape.ok) return shape

    const index = validateSafeInteger(shape.descriptors.index.value, '/index')
    if (!index.ok) return index

    if (kind === 'perp' && index.value >= 10_000) {
      return {
        ok: false,
        issue: issue('asset-index-out-of-range', '/index', index.value, '< 10000'),
      }
    }
    if (kind === 'spot' && 10_000 + index.value >= 100_000) {
      return {
        ok: false,
        issue: issue('asset-index-out-of-range', '/index', index.value, '< 90000'),
      }
    }

    return { ok: true, value: { kind, index: index.value } }
  }

  if (kind === 'hip3-perp') {
    const shape = normalizePlainShape<{
      readonly kind: unknown
      readonly dexIndex: unknown
      readonly index: unknown
    }>(
      input,
      ['kind', 'dexIndex', 'index'],
      'plain object with exactly kind, dexIndex, and index own data fields',
    )
    if (!shape.ok) return shape

    const dexIndex = validateSafeInteger(shape.descriptors.dexIndex.value, '/dexIndex')
    if (!dexIndex.ok) return dexIndex
    const index = validateSafeInteger(shape.descriptors.index.value, '/index')
    if (!index.ok) return index

    if (dexIndex.value < 1) {
      return {
        ok: false,
        issue: issue('dex-index-out-of-range', '/dexIndex', dexIndex.value, '>= 1'),
      }
    }
    if (index.value >= 10_000) {
      return {
        ok: false,
        issue: issue('asset-index-out-of-range', '/index', index.value, '< 10000'),
      }
    }
    const encoded = 100_000 + dexIndex.value * 10_000 + index.value
    if (encoded >= 100_000_000) {
      return {
        ok: false,
        issue: issue(
          'dex-index-out-of-range',
          '/dexIndex',
          dexIndex.value,
          'encoded asset ID < 100000000',
        ),
      }
    }

    return { ok: true, value: { kind, dexIndex: dexIndex.value, index: index.value } }
  }

  if (kind === 'outcome') {
    const shape = normalizePlainShape<{
      readonly kind: unknown
      readonly outcome: unknown
      readonly side: unknown
    }>(
      input,
      ['kind', 'outcome', 'side'],
      'plain object with exactly kind, outcome, and side own data fields',
    )
    if (!shape.ok) return shape

    const outcome = validateSafeInteger(shape.descriptors.outcome.value, '/outcome')
    if (!outcome.ok) return outcome
    const side = validateSafeInteger(shape.descriptors.side.value, '/side')
    if (!side.ok) return side
    if (side.value !== 0 && side.value !== 1) {
      return {
        ok: false,
        issue: issue('invalid-outcome-side', '/side', side.value, '0 or 1'),
      }
    }

    const encoded = 100_000_000n + BigInt(outcome.value) * 10n + BigInt(side.value)
    if (encoded > BigInt(Number.MAX_SAFE_INTEGER)) {
      return {
        ok: false,
        issue: issue(
          'outcome-index-out-of-range',
          '/outcome',
          outcome.value,
          'encoded asset ID must be a safe integer',
        ),
      }
    }

    return {
      ok: true,
      value: { kind, outcome: outcome.value, side: side.value as 0 | 1 },
    }
  }

  return {
    ok: false,
    issue: issue('invalid-kind', '/kind', kind, 'perp, spot, hip3-perp, or outcome'),
  }
}

/**
 * Encodes a metadata index into the numeric protocol asset ID: perp `index`, spot
 * `10000 + index`, HIP-3 perp `100000 + dexIndex * 10000 + index` (dexIndex starts at 1), and
 * outcome `100000000 + 10 * outcome + side`.
 * Range-checks against the protocol's 10,000-ID blocks; it does not check the index exists.
 *
 * @public
 */
export function encodeAssetId(input: AssetIdEncodeInput): MathResult<number> {
  const validated = validateEncodeInput(input)
  if (!validated.ok) return invalidResult(encodeFormulaId, validated.issue)

  const normalized = validated.value
  const encoded =
    normalized.kind === 'perp'
      ? normalized.index
      : normalized.kind === 'spot'
        ? 10_000 + normalized.index
        : normalized.kind === 'hip3-perp'
          ? 100_000 + normalized.dexIndex * 10_000 + normalized.index
          : Number(100_000_000n + BigInt(normalized.outcome) * 10n + BigInt(normalized.side))

  return okResult(
    encoded,
    createIdentifierTrace({
      formulaId: encodeFormulaId,
      formulaVersion: 2,
      maturity: normalized.kind === 'outcome' ? 'experimental' : 'stable',
      completion: { status: 'complete' },
      normalizedInputs: normalized,
      intermediates: [{ stepId: 'encode-asset-id', inputs: normalized, output: encoded }],
      sourceRefs: assetIdSourceRefs,
    }),
  )
}

function validateDecodeInput(
  input: unknown,
):
  | { readonly ok: true; readonly assetId: number }
  | { readonly ok: false; readonly issue: MathIssue } {
  const shape = normalizePlainShape<AssetIdDecodeInput>(input, ['assetId'], expectedDecodeShape)
  if (!shape.ok) return shape

  const assetId = validateSafeInteger(shape.descriptors.assetId.value, '/assetId')
  if (!assetId.ok) return assetId

  return { ok: true, assetId: assetId.value }
}

/**
 * Decodes `{ assetId }` back to its market kind and metadata index: `0..9999` perp,
 * `10000..99999` spot, `110000..99999999` HIP-3 perp via `dexIndex = floor((id - 100000) / 10000)`.
 * The undocumented `100000..109999` gap is `invalid-input`; outcome IDs decode by
 * `encoding = assetId - 100000000`, `side = encoding mod 10`, and `outcome = floor(encoding / 10)`.
 *
 * @public
 */
export function decodeAssetId(input: AssetIdDecodeInput): MathResult<AssetIdDecodeOutput> {
  const validated = validateDecodeInput(input)
  if (!validated.ok) return invalidResult(decodeFormulaId, validated.issue)

  const { assetId } = validated
  if (assetId >= 100_000_000) {
    const encoding = BigInt(assetId) - 100_000_000n
    const side = Number(encoding % 10n)
    if (side !== 0 && side !== 1) {
      return invalidResult(
        decodeFormulaId,
        issue(
          'invalid-outcome-side-encoding',
          '/assetId',
          assetId,
          'outcome encoding ending in side digit 0 or 1',
        ),
        { assetId },
        'experimental',
      )
    }

    const decoded: AssetIdDecodeOutput = {
      kind: 'outcome',
      outcome: Number(encoding / 10n),
      side: side as 0 | 1,
    }
    return okResult(
      decoded,
      createIdentifierTrace({
        formulaId: decodeFormulaId,
        formulaVersion: 2,
        maturity: 'experimental',
        completion: { status: 'complete' },
        normalizedInputs: { assetId },
        intermediates: [
          { stepId: 'decode-outcome-asset-id', inputs: { assetId }, output: decoded },
        ],
        sourceRefs: assetIdSourceRefs,
      }),
    )
  }

  if (assetId >= 100_000 && assetId <= 109_999) {
    return invalidResult(
      decodeFormulaId,
      issue('unsupported-asset-id-gap', '/assetId', assetId, 'outside 100000..109999'),
      { assetId },
    )
  }

  const decoded: AssetIdDecodeOutput =
    assetId < 10_000
      ? { kind: 'perp', index: assetId }
      : assetId < 100_000
        ? { kind: 'spot', index: assetId - 10_000 }
        : {
            kind: 'hip3-perp',
            dexIndex: Math.floor((assetId - 100_000) / 10_000),
            index: (assetId - 100_000) % 10_000,
          }

  return okResult(
    decoded,
    createIdentifierTrace({
      formulaId: decodeFormulaId,
      formulaVersion: 2,
      completion: { status: 'complete' },
      normalizedInputs: { assetId },
      intermediates: [{ stepId: 'decode-asset-id', inputs: { assetId }, output: decoded }],
      sourceRefs: assetIdSourceRefs,
    }),
  )
}
