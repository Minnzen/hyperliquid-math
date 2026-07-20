import {
  exactPlainArray,
  exactPlainObject,
  issue,
  normalizeDecimalAt,
  ownDataValue,
} from '../core/validation.js'
import {
  assetKey,
  normalizePerpMarginAssetRef,
  normalizePerpMarginTiers,
} from '../margin/validation.js'
import type { MathIssue, MathReason } from '../model/index.js'
import type { NormalizedLiquidationInput, NormalizedLiquidationPosition } from './types.js'

const maxPositions = 256

export function reason(code: string, path: string): MathReason {
  return { code, path }
}

function normalizeMarginMode(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly mode: NormalizedLiquidationPosition['marginMode'] }
  | { readonly ok: false; readonly issue: MathIssue } {
  const crossShape = exactPlainObject(input, ['kind'], path)
  if (crossShape.ok && ownDataValue(crossShape.object, 'kind') === 'cross') {
    return { ok: true, mode: { kind: 'cross' } }
  }

  const isolatedShape = exactPlainObject(
    input,
    ['kind', 'isolatedMarginValue', 'marginRemoval'],
    path,
  )
  if (!isolatedShape.ok) return isolatedShape
  if (ownDataValue(isolatedShape.object, 'kind') !== 'isolated') {
    return {
      ok: false,
      issue: issue(
        'invalid-margin-mode',
        `${path}/kind`,
        ownDataValue(isolatedShape.object, 'kind'),
        'cross or isolated',
      ),
    }
  }

  const isolatedMarginValue = normalizeDecimalAt(
    ownDataValue(isolatedShape.object, 'isolatedMarginValue'),
    `${path}/isolatedMarginValue`,
    'signed',
  )
  if (!isolatedMarginValue.ok) return isolatedMarginValue
  const marginRemoval = ownDataValue(isolatedShape.object, 'marginRemoval')
  if (marginRemoval !== 'allowed' && marginRemoval !== 'strict') {
    return {
      ok: false,
      issue: issue(
        'invalid-margin-removal',
        `${path}/marginRemoval`,
        marginRemoval,
        'allowed or strict',
      ),
    }
  }

  return {
    ok: true,
    mode: {
      kind: 'isolated',
      isolatedMarginValue: isolatedMarginValue.value,
      isolatedMarginValueDecimal: isolatedMarginValue.decimal,
      marginRemoval,
    },
  }
}

function normalizePosition(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly position: NormalizedLiquidationPosition }
  | { readonly ok: false; readonly issue: MathIssue } {
  const shape = exactPlainObject(
    input,
    ['asset', 'signedSize', 'entryPrice', 'markPrice', 'marginMode', 'marginTiers'],
    path,
  )
  if (!shape.ok) return shape

  const asset = normalizePerpMarginAssetRef(ownDataValue(shape.object, 'asset'), `${path}/asset`)
  if (!asset.ok) return asset
  const signedSize = normalizeDecimalAt(
    ownDataValue(shape.object, 'signedSize'),
    `${path}/signedSize`,
    'signed',
  )
  if (!signedSize.ok) return signedSize
  if (signedSize.decimal.isZero()) {
    return {
      ok: false,
      issue: issue(
        'zero-position-size',
        `${path}/signedSize`,
        signedSize.value,
        'non-zero signed decimal string',
      ),
    }
  }
  const entryPrice = normalizeDecimalAt(
    ownDataValue(shape.object, 'entryPrice'),
    `${path}/entryPrice`,
    'positive',
  )
  if (!entryPrice.ok) return entryPrice
  const markPrice = normalizeDecimalAt(
    ownDataValue(shape.object, 'markPrice'),
    `${path}/markPrice`,
    'positive',
  )
  if (!markPrice.ok) return markPrice
  const marginMode = normalizeMarginMode(
    ownDataValue(shape.object, 'marginMode'),
    `${path}/marginMode`,
  )
  if (!marginMode.ok) return marginMode
  const marginTiers = normalizePerpMarginTiers(
    ownDataValue(shape.object, 'marginTiers'),
    `${path}/marginTiers`,
  )
  if (!marginTiers.ok) return marginTiers

  return {
    ok: true,
    position: {
      asset: asset.value,
      assetKey: assetKey(asset.value),
      signedSize: signedSize.value,
      signedSizeDecimal: signedSize.decimal,
      entryPrice: entryPrice.value,
      markPrice: markPrice.value,
      markPriceDecimal: markPrice.decimal,
      marginMode: marginMode.mode,
      marginTiers: marginTiers.value,
    },
  }
}

export function normalizeLiquidationInput(
  input: unknown,
):
  | { readonly ok: true; readonly value: NormalizedLiquidationInput }
  | { readonly ok: false; readonly issue: MathIssue } {
  const shape = exactPlainObject(input, ['targetAsset', 'crossAccountValue', 'positions'], '')
  if (!shape.ok) return shape

  const targetAsset = normalizePerpMarginAssetRef(
    ownDataValue(shape.object, 'targetAsset'),
    '/targetAsset',
  )
  if (!targetAsset.ok) return targetAsset
  const targetAssetKey = assetKey(targetAsset.value)
  const crossAccountValue = normalizeDecimalAt(
    ownDataValue(shape.object, 'crossAccountValue'),
    '/crossAccountValue',
    'signed',
  )
  if (!crossAccountValue.ok) return crossAccountValue
  const positionsInput = exactPlainArray(ownDataValue(shape.object, 'positions'), '/positions', {
    maxLength: maxPositions,
  })
  if (!positionsInput.ok) return positionsInput

  const positions: NormalizedLiquidationPosition[] = []
  const seenAssets = new Map<string, number>()
  let targetPositionIndex = -1
  for (const [index, rawPosition] of positionsInput.values.entries()) {
    const position = normalizePosition(rawPosition, `/positions/${index}`)
    if (!position.ok) return position
    const previousIndex = seenAssets.get(position.position.assetKey)
    if (previousIndex !== undefined) {
      return {
        ok: false,
        issue: issue(
          'duplicate-asset',
          `/positions/${index}/asset`,
          position.position.assetKey,
          `unique canonical asset key; first seen at /positions/${previousIndex}/asset`,
        ),
      }
    }
    seenAssets.set(position.position.assetKey, index)
    if (position.position.assetKey === targetAssetKey) targetPositionIndex = index
    positions.push(position.position)
  }

  if (targetPositionIndex < 0) {
    return {
      ok: false,
      issue: issue('missing-target-asset', '/targetAsset', targetAssetKey, 'asset in positions'),
    }
  }

  return {
    ok: true,
    value: {
      targetAsset: targetAsset.value,
      targetAssetKey,
      crossAccountValue: crossAccountValue.value,
      crossAccountValueDecimal: crossAccountValue.decimal,
      positions,
      targetPositionIndex,
    },
  }
}
