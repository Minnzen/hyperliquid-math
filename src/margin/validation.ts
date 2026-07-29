import { derivePerpAssetKey, normalizePerpAssetRefAt } from '../core/asset-ref.js'
import { Decimal40 } from '../core/decimal.js'
import {
  exactPlainArray,
  exactPlainObject,
  issue,
  normalizeDecimalAt,
  ownDataValue,
  reason,
  type ValidationIssue,
} from '../core/validation.js'
import type { MathIssue } from '../model/index.js'
import type {
  CanonicalAssetRef,
  NormalizedCalculateUnifiedAccountRatioInput,
  NormalizedEvaluatePerpAccountMarginInput,
  NormalizedPerpMarginPosition,
  NormalizedPerpMarginTier,
  NormalizedUnifiedAccountDexMargin,
  NormalizedUnifiedAccountSpotBalance,
} from './types.js'

export { reason }

export type NormalizedResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: MathIssue }

const decimalOne = new Decimal40(1)
const decimalTwo = new Decimal40(2)
const positionKeys = [
  'asset',
  'signedSize',
  'markPrice',
  'leverage',
  'marginMode',
  'marginTiers',
] as const

function withPath(issueValue: ValidationIssue | MathIssue, prefix: string): MathIssue {
  return { ...issueValue, path: `${prefix}${issueValue.path ?? ''}` }
}

export function normalizePerpMarginAssetRef(
  input: unknown,
  path: string,
): NormalizedResult<CanonicalAssetRef> {
  const asset = normalizePerpAssetRefAt(input, path)
  if (!asset.ok) return { ok: false, issue: asset.issue }
  return { ok: true, value: asset.value }
}

export function assetKey(asset: CanonicalAssetRef): string {
  return derivePerpAssetKey(asset)
}

function normalizeLeverage(
  input: unknown,
  path: string,
  maxLeverage: InstanceType<typeof Decimal40>,
): NormalizedResult<NormalizedPerpMarginPosition['leverage']> {
  const value = normalizeDecimalAt(input, path, 'signed')
  if (!value.ok) return { ok: false, issue: value.issue }
  if (!value.decimal.isInteger() || value.decimal.lt(1) || value.decimal.gt(maxLeverage)) {
    return {
      ok: false,
      issue: issue(
        'invalid-leverage',
        path,
        value.value,
        `integer between 1 and ${maxLeverage.toFixed()}`,
      ),
    }
  }

  return { ok: true, value: { value: value.value, valueDecimal: value.decimal } }
}

function normalizeMarginMode(
  input: unknown,
  path: string,
): NormalizedResult<NormalizedPerpMarginPosition['marginMode']> {
  const root = exactPlainObject(input, ['kind'], path)
  if (root.ok) {
    const kind = ownDataValue(root.object, 'kind')
    if (kind === 'cross') return { ok: true, value: { kind } }
    return {
      ok: false,
      issue: issue('invalid-margin-mode', `${path}/kind`, kind, 'cross or isolated'),
    }
  }

  const isolated = exactPlainObject(input, ['kind', 'isolatedMarginValue', 'marginRemoval'], path)
  if (!isolated.ok) return { ok: false, issue: isolated.issue }
  const kind = ownDataValue(isolated.object, 'kind')
  if (kind !== 'isolated') {
    return {
      ok: false,
      issue: issue('invalid-margin-mode', `${path}/kind`, kind, 'cross or isolated'),
    }
  }
  const isolatedMarginValue = normalizeDecimalAt(
    ownDataValue(isolated.object, 'isolatedMarginValue'),
    `${path}/isolatedMarginValue`,
    'signed',
  )
  if (!isolatedMarginValue.ok) return { ok: false, issue: isolatedMarginValue.issue }
  const marginRemoval = ownDataValue(isolated.object, 'marginRemoval')
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
    value: {
      kind,
      isolatedMarginValue: isolatedMarginValue.value,
      isolatedMarginValueDecimal: isolatedMarginValue.decimal,
      marginRemoval,
    },
  }
}

export function normalizePerpMarginTiers(
  input: unknown,
  path: string,
): NormalizedResult<readonly NormalizedPerpMarginTier[]> {
  const tiers = exactPlainArray(input, path, { maxLength: 1000 })
  if (!tiers.ok) return { ok: false, issue: tiers.issue }
  if (tiers.values.length === 0) {
    return {
      ok: false,
      issue: issue('invalid-margin-tiers', path, 'empty-array', 'non-empty tier array'),
    }
  }

  const normalized: NormalizedPerpMarginTier[] = []
  let previousLowerBound: InstanceType<typeof Decimal40> | undefined
  let previousRate: InstanceType<typeof Decimal40> | undefined
  let previousDeduction = new Decimal40(0)

  for (const [index, tierInput] of tiers.values.entries()) {
    const tierPath = `${path}/${index}`
    const tier = exactPlainObject(tierInput, ['lowerBound', 'maxLeverage'], tierPath)
    if (!tier.ok) return { ok: false, issue: tier.issue }

    const lowerBound = normalizeDecimalAt(
      ownDataValue(tier.object, 'lowerBound'),
      `${tierPath}/lowerBound`,
      'non-negative',
    )
    if (!lowerBound.ok) return { ok: false, issue: lowerBound.issue }
    const maxLeverage = normalizeDecimalAt(
      ownDataValue(tier.object, 'maxLeverage'),
      `${tierPath}/maxLeverage`,
      'positive',
    )
    if (!maxLeverage.ok) return { ok: false, issue: maxLeverage.issue }
    if (!maxLeverage.decimal.isInteger()) {
      return {
        ok: false,
        issue: issue(
          'invalid-margin-tier-max-leverage',
          `${tierPath}/maxLeverage`,
          maxLeverage.value,
          'positive integer',
        ),
      }
    }

    if (index === 0 && !lowerBound.decimal.isZero()) {
      return {
        ok: false,
        issue: issue(
          'invalid-margin-tier-lower-bound',
          `${tierPath}/lowerBound`,
          lowerBound.value,
          '0',
        ),
      }
    }
    if (previousLowerBound !== undefined && lowerBound.decimal.lte(previousLowerBound)) {
      return {
        ok: false,
        issue: issue(
          'invalid-margin-tier-lower-bound',
          `${tierPath}/lowerBound`,
          lowerBound.value,
          'strictly increasing lower bound',
        ),
      }
    }

    const maintenanceRateDecimal = decimalOne.div(decimalTwo.mul(maxLeverage.decimal))
    const maintenanceDeductionDecimal =
      previousRate === undefined
        ? new Decimal40(0)
        : previousDeduction.plus(lowerBound.decimal.mul(maintenanceRateDecimal.minus(previousRate)))

    if (maintenanceDeductionDecimal.isNegative()) {
      return {
        ok: false,
        issue: issue(
          'invalid-margin-tier-deduction',
          `${tierPath}/maxLeverage`,
          maintenanceDeductionDecimal.toFixed(),
          'non-negative maintenance deduction',
        ),
      }
    }

    normalized.push({
      lowerBound: lowerBound.value,
      lowerBoundDecimal: lowerBound.decimal,
      maxLeverage: maxLeverage.value,
      maxLeverageDecimal: maxLeverage.decimal,
      maintenanceRate:
        maintenanceRateDecimal.toFixed() as NormalizedPerpMarginTier['maintenanceRate'],
      maintenanceRateDecimal,
      maintenanceDeduction:
        maintenanceDeductionDecimal.toFixed() as NormalizedPerpMarginTier['maintenanceDeduction'],
      maintenanceDeductionDecimal,
    })

    previousLowerBound = lowerBound.decimal
    previousRate = maintenanceRateDecimal
    previousDeduction = maintenanceDeductionDecimal
  }

  return { ok: true, value: normalized }
}

export function normalizePerpMarginPosition(
  input: unknown,
  path: string,
): NormalizedResult<NormalizedPerpMarginPosition> {
  const position = exactPlainObject(input, positionKeys, path)
  if (!position.ok) return { ok: false, issue: position.issue }

  const asset = normalizePerpMarginAssetRef(ownDataValue(position.object, 'asset'), `${path}/asset`)
  if (!asset.ok) return asset
  const signedSize = normalizeDecimalAt(
    ownDataValue(position.object, 'signedSize'),
    `${path}/signedSize`,
    'signed',
  )
  if (!signedSize.ok) return { ok: false, issue: signedSize.issue }
  const markPrice = normalizeDecimalAt(
    ownDataValue(position.object, 'markPrice'),
    `${path}/markPrice`,
    'positive',
  )
  if (!markPrice.ok) return { ok: false, issue: markPrice.issue }

  const marginTiers = normalizePerpMarginTiers(
    ownDataValue(position.object, 'marginTiers'),
    `${path}/marginTiers`,
  )
  if (!marginTiers.ok) return marginTiers

  const firstTier = marginTiers.value[0]
  if (firstTier === undefined) {
    return {
      ok: false,
      issue: issue(
        'invalid-margin-tiers',
        `${path}/marginTiers`,
        'empty-array',
        'non-empty tier array',
      ),
    }
  }
  const leverage = normalizeLeverage(
    ownDataValue(position.object, 'leverage'),
    `${path}/leverage`,
    firstTier.maxLeverageDecimal,
  )
  if (!leverage.ok) return leverage

  const marginMode = normalizeMarginMode(
    ownDataValue(position.object, 'marginMode'),
    `${path}/marginMode`,
  )
  if (!marginMode.ok) return marginMode

  return {
    ok: true,
    value: {
      asset: asset.value,
      assetKey: assetKey(asset.value),
      signedSize: signedSize.value,
      signedSizeDecimal: signedSize.decimal,
      absoluteSizeDecimal: signedSize.decimal.abs(),
      markPrice: markPrice.value,
      markPriceDecimal: markPrice.decimal,
      leverage: leverage.value,
      marginMode: marginMode.value,
      marginTiers: marginTiers.value,
    },
  }
}

export function normalizeInitialMarginInput(
  input: unknown,
): NormalizedResult<NormalizedPerpMarginPosition> {
  const root = exactPlainObject(input, ['position'], '')
  if (!root.ok) return { ok: false, issue: root.issue }
  const position = normalizePerpMarginPosition(ownDataValue(root.object, 'position'), '/position')
  if (!position.ok) return position
  return { ok: true, value: position.value }
}

export const normalizeMaintenanceMarginInput = normalizeInitialMarginInput

export function normalizeEvaluatePerpAccountMarginInput(
  input: unknown,
): NormalizedResult<NormalizedEvaluatePerpAccountMarginInput> {
  const root = exactPlainObject(input, ['crossAccountValue', 'positions'], '')
  if (!root.ok) return { ok: false, issue: root.issue }
  const crossAccountValue = normalizeDecimalAt(
    ownDataValue(root.object, 'crossAccountValue'),
    '/crossAccountValue',
    'signed',
  )
  if (!crossAccountValue.ok) return { ok: false, issue: crossAccountValue.issue }
  const positionsInput = exactPlainArray(ownDataValue(root.object, 'positions'), '/positions', {
    maxLength: 5000,
  })
  if (!positionsInput.ok) return { ok: false, issue: positionsInput.issue }

  const seen = new Set<string>()
  const positions: NormalizedPerpMarginPosition[] = []
  for (const [index, positionInput] of positionsInput.values.entries()) {
    const position = normalizePerpMarginPosition(positionInput, `/positions/${index}`)
    if (!position.ok) return position
    if (seen.has(position.value.assetKey)) {
      return {
        ok: false,
        issue: issue(
          'duplicate-asset',
          `/positions/${index}/asset`,
          position.value.assetKey,
          'unique canonical asset key',
        ),
      }
    }
    seen.add(position.value.assetKey)
    positions.push(position.value)
  }

  return {
    ok: true,
    value: {
      crossAccountValue: crossAccountValue.value,
      crossAccountValueDecimal: crossAccountValue.decimal,
      positions,
    },
  }
}

function normalizeNonNegativeSafeInteger(input: unknown, path: string): NormalizedResult<number> {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
    return {
      ok: false,
      issue: issue('invalid-index', path, input, 'non-negative safe integer'),
    }
  }
  return { ok: true, value: input }
}

function normalizeUnifiedDexMargin(
  input: unknown,
  path: string,
): NormalizedResult<NormalizedUnifiedAccountDexMargin> {
  const row = exactPlainObject(
    input,
    ['dexIndex', 'collateralToken', 'crossMaintenanceMarginUsed', 'isolatedMarginUsed'],
    path,
  )
  if (!row.ok) return { ok: false, issue: row.issue }

  const dexIndex = normalizeNonNegativeSafeInteger(
    ownDataValue(row.object, 'dexIndex'),
    `${path}/dexIndex`,
  )
  if (!dexIndex.ok) return dexIndex
  const collateralToken = normalizeNonNegativeSafeInteger(
    ownDataValue(row.object, 'collateralToken'),
    `${path}/collateralToken`,
  )
  if (!collateralToken.ok) return collateralToken
  const crossMaintenanceMarginUsed = normalizeDecimalAt(
    ownDataValue(row.object, 'crossMaintenanceMarginUsed'),
    `${path}/crossMaintenanceMarginUsed`,
    'non-negative',
  )
  if (!crossMaintenanceMarginUsed.ok) {
    return { ok: false, issue: crossMaintenanceMarginUsed.issue }
  }
  const isolatedMarginUsed = normalizeDecimalAt(
    ownDataValue(row.object, 'isolatedMarginUsed'),
    `${path}/isolatedMarginUsed`,
    'non-negative',
  )
  if (!isolatedMarginUsed.ok) return { ok: false, issue: isolatedMarginUsed.issue }

  return {
    ok: true,
    value: {
      dexIndex: dexIndex.value,
      collateralToken: collateralToken.value,
      crossMaintenanceMarginUsed: crossMaintenanceMarginUsed.value,
      crossMaintenanceMarginUsedDecimal: crossMaintenanceMarginUsed.decimal,
      isolatedMarginUsed: isolatedMarginUsed.value,
      isolatedMarginUsedDecimal: isolatedMarginUsed.decimal,
    },
  }
}

function normalizeUnifiedSpotBalance(
  input: unknown,
  path: string,
  inputIndex: number,
): NormalizedResult<NormalizedUnifiedAccountSpotBalance> {
  const row = exactPlainObject(input, ['token', 'total'], path)
  if (!row.ok) return { ok: false, issue: row.issue }

  const token = normalizeNonNegativeSafeInteger(ownDataValue(row.object, 'token'), `${path}/token`)
  if (!token.ok) return token
  const total = normalizeDecimalAt(ownDataValue(row.object, 'total'), `${path}/total`, 'signed')
  if (!total.ok) return { ok: false, issue: total.issue }

  return {
    ok: true,
    value: {
      inputIndex,
      token: token.value,
      total: total.value,
      totalDecimal: total.decimal,
    },
  }
}

export function normalizeCalculateUnifiedAccountRatioInput(
  input: unknown,
): NormalizedResult<NormalizedCalculateUnifiedAccountRatioInput> {
  const root = exactPlainObject(input, ['dexes', 'spotBalances'], '')
  if (!root.ok) return { ok: false, issue: root.issue }

  const dexInputs = exactPlainArray(ownDataValue(root.object, 'dexes'), '/dexes', {
    maxLength: 1024,
  })
  if (!dexInputs.ok) return { ok: false, issue: dexInputs.issue }
  const spotInputs = exactPlainArray(ownDataValue(root.object, 'spotBalances'), '/spotBalances', {
    maxLength: 1024,
  })
  if (!spotInputs.ok) return { ok: false, issue: spotInputs.issue }

  const dexIndexes = new Set<number>()
  const dexes: NormalizedUnifiedAccountDexMargin[] = []
  for (const [index, inputRow] of dexInputs.values.entries()) {
    const dex = normalizeUnifiedDexMargin(inputRow, `/dexes/${index}`)
    if (!dex.ok) return dex
    if (dexIndexes.has(dex.value.dexIndex)) {
      return {
        ok: false,
        issue: issue(
          'duplicate-dex-index',
          `/dexes/${index}/dexIndex`,
          dex.value.dexIndex,
          'unique dexIndex',
        ),
      }
    }
    dexIndexes.add(dex.value.dexIndex)
    dexes.push(dex.value)
  }

  const spotTokens = new Set<number>()
  const spotBalances: NormalizedUnifiedAccountSpotBalance[] = []
  for (const [index, inputRow] of spotInputs.values.entries()) {
    const spot = normalizeUnifiedSpotBalance(inputRow, `/spotBalances/${index}`, index)
    if (!spot.ok) return spot
    if (spotTokens.has(spot.value.token)) {
      return {
        ok: false,
        issue: issue(
          'duplicate-spot-token',
          `/spotBalances/${index}/token`,
          spot.value.token,
          'unique spot token',
        ),
      }
    }
    spotTokens.add(spot.value.token)
    spotBalances.push(spot.value)
  }

  const referencedTokens = new Set(dexes.map((dex) => dex.collateralToken))
  for (const collateralToken of referencedTokens) {
    if (!spotTokens.has(collateralToken)) {
      return {
        ok: false,
        issue: issue(
          'missing-unified-spot-balance',
          '/spotBalances',
          `missing-token:${collateralToken}`,
          'explicit spot balance for every referenced collateral token',
        ),
      }
    }
  }

  return { ok: true, value: { dexes, spotBalances } }
}

export function prefixIssue(issueValue: MathIssue, prefix: string): MathIssue {
  return withPath(issueValue, prefix)
}

export function validateNonZeroPosition(
  position: NormalizedPerpMarginPosition,
  path: string,
): NormalizedResult<NormalizedPerpMarginPosition> {
  if (position.signedSizeDecimal.isZero()) {
    return {
      ok: false,
      issue: issue(
        'zero-position-size',
        `${path}/signedSize`,
        position.signedSize,
        'non-zero exposure',
      ),
    }
  }
  return { ok: true, value: position }
}
