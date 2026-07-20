import { Decimal40 } from '../core/decimal.js'
import {
  exactPlainArray,
  exactPlainObject,
  issue,
  normalizeDecimalAt,
  normalizeMathReason,
  ownDataValue,
  type ValidationIssue,
} from '../core/validation.js'
import {
  assetKey as derivePerpAssetKey,
  normalizePerpMarginAssetRef,
  normalizePerpMarginTiers,
} from '../margin/validation.js'
import { normalizeFill, normalizePosition } from '../positions/validation.js'
import type {
  CanonicalPerpScenarioAssetRef,
  IsolatedMarginAllocation,
  LeverageMarginEffect,
  NormalizedAction,
  NormalizedInput,
  NormalizedMarket,
  NormalizedScenarioPosition,
  PerpScenarioPosition,
} from './types.js'

function ownKind(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return undefined
  return Reflect.getOwnPropertyDescriptor(input, 'kind')?.value
}

function normalizeAsset(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly asset: CanonicalPerpScenarioAssetRef; readonly assetKey: string }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const normalized = normalizePerpMarginAssetRef(input, path)
  if (!normalized.ok) {
    return {
      ok: false,
      issue: { ...normalized.issue, path: normalized.issue.path ?? path },
    }
  }
  return {
    ok: true,
    asset: normalized.value,
    assetKey: derivePerpAssetKey(normalized.value),
  }
}

function normalizeTierArray(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly tiers: NormalizedMarket['marginTiers'] }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const normalized = normalizePerpMarginTiers(input, path)
  if (!normalized.ok) {
    return {
      ok: false,
      issue: { ...normalized.issue, path: normalized.issue.path ?? path },
    }
  }
  return { ok: true, tiers: normalized.value }
}

function normalizeMarket(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly market: NormalizedMarket }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['asset', 'markPrice', 'maxLeverage', 'marginTiers'], path)
  if (!shape.ok) return shape
  const asset = normalizeAsset(ownDataValue(shape.object, 'asset'), `${path}/asset`)
  if (!asset.ok) return asset
  const markPrice = normalizeDecimalAt(
    ownDataValue(shape.object, 'markPrice'),
    `${path}/markPrice`,
    'positive',
  )
  if (!markPrice.ok) return markPrice
  const maxLeverage = normalizeDecimalAt(
    ownDataValue(shape.object, 'maxLeverage'),
    `${path}/maxLeverage`,
    'positive',
  )
  if (!maxLeverage.ok) return maxLeverage
  if (!maxLeverage.decimal.isInteger()) {
    return {
      ok: false,
      issue: issue(
        'invalid-max-leverage',
        `${path}/maxLeverage`,
        maxLeverage.value,
        'positive integer',
      ),
    }
  }
  const tiers = normalizeTierArray(ownDataValue(shape.object, 'marginTiers'), `${path}/marginTiers`)
  if (!tiers.ok) return tiers
  if (!maxLeverage.decimal.eq(tiers.tiers[0]?.maxLeverageDecimal ?? new Decimal40(0))) {
    return {
      ok: false,
      issue: issue(
        'max-leverage-tier-mismatch',
        `${path}/maxLeverage`,
        maxLeverage.value,
        'same value as the first margin tier maxLeverage',
      ),
    }
  }
  return {
    ok: true,
    market: {
      asset: asset.asset,
      assetKey: asset.assetKey,
      markPrice: markPrice.value,
      markPriceDecimal: markPrice.decimal,
      maxLeverage: maxLeverage.value,
      maxLeverageDecimal: maxLeverage.decimal,
      marginTiers: tiers.tiers,
    },
  }
}

function normalizePositionMarginMode(
  input: unknown,
  path: string,
  stateKind: 'flat' | 'open',
):
  | {
      readonly ok: true
      readonly marginMode:
        | NormalizedScenarioPosition['marginMode']
        | PerpScenarioPosition['marginMode']
    }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const crossShape = exactPlainObject(input, ['kind'], path)
  if (crossShape.ok && ownDataValue(crossShape.object, 'kind') === 'cross')
    return { ok: true, marginMode: { kind: 'cross' } }
  const isolatedKeys =
    stateKind === 'open'
      ? ['kind', 'isolatedMarginValue', 'marginRemoval']
      : ['kind', 'marginRemoval']
  const isolatedShape = exactPlainObject(input, isolatedKeys, path)
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
  if (stateKind === 'flat') return { ok: true, marginMode: { kind: 'isolated', marginRemoval } }
  const isolatedMarginValue = normalizeDecimalAt(
    ownDataValue(isolatedShape.object, 'isolatedMarginValue'),
    `${path}/isolatedMarginValue`,
    'signed',
  )
  if (!isolatedMarginValue.ok) return isolatedMarginValue
  return {
    ok: true,
    marginMode: {
      kind: 'isolated',
      isolatedMarginValue: isolatedMarginValue.value,
      isolatedMarginValueDecimal: isolatedMarginValue.decimal,
      marginRemoval,
    },
  }
}

function normalizeScenarioPosition(
  input: unknown,
  path: string,
  markets: ReadonlyMap<string, NormalizedMarket>,
):
  | { readonly ok: true; readonly position: NormalizedScenarioPosition }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const baseShape = exactPlainObject(input, ['kind', 'asset', 'marginMode', 'leverage'], path)
  const shape =
    baseShape.ok && ownDataValue(baseShape.object, 'kind') === 'flat'
      ? baseShape
      : exactPlainObject(
          input,
          ['kind', 'asset', 'signedSize', 'entryPrice', 'marginMode', 'leverage'],
          path,
        )
  if (!shape.ok) return shape
  const kind = ownDataValue(shape.object, 'kind')
  if (kind !== 'flat' && kind !== 'open') {
    return {
      ok: false,
      issue: issue('invalid-position-kind', `${path}/kind`, kind, 'flat or open'),
    }
  }
  const asset = normalizeAsset(ownDataValue(shape.object, 'asset'), `${path}/asset`)
  if (!asset.ok) return asset
  const market = markets.get(asset.assetKey)
  if (market === undefined) {
    return {
      ok: false,
      issue: issue(
        'unknown-market-asset',
        `${path}/asset`,
        asset.assetKey,
        'asset in snapshot.markets',
      ),
    }
  }
  const positionState =
    kind === 'flat'
      ? ({ ok: true, position: { kind: 'flat' } } as const)
      : normalizePosition(
          {
            kind: 'open',
            signedSize: ownDataValue(shape.object, 'signedSize'),
            entryPrice: ownDataValue(shape.object, 'entryPrice'),
          },
          path,
        )
  if (!positionState.ok) return positionState
  const marginMode = normalizePositionMarginMode(
    ownDataValue(shape.object, 'marginMode'),
    `${path}/marginMode`,
    kind,
  )
  if (!marginMode.ok) return marginMode
  const leverage = normalizeDecimalAt(
    ownDataValue(shape.object, 'leverage'),
    `${path}/leverage`,
    'positive',
  )
  if (!leverage.ok) return leverage
  if (!leverage.decimal.isInteger() || leverage.decimal.greaterThan(market.maxLeverageDecimal)) {
    return {
      ok: false,
      issue: issue(
        'invalid-leverage',
        `${path}/leverage`,
        leverage.value,
        `integer <= ${market.maxLeverage}`,
      ),
    }
  }
  if (kind === 'flat' && marginMode.marginMode.kind === 'isolated') {
    return {
      ok: true,
      position: {
        asset: asset.asset,
        assetKey: asset.assetKey,
        state: positionState.position,
        leverage: leverage.value,
        leverageDecimal: leverage.decimal,
        marginMode: {
          kind: 'isolated',
          isolatedMarginValue: '0',
          isolatedMarginValueDecimal: new Decimal40(0),
          marginRemoval: marginMode.marginMode.marginRemoval,
        },
      },
    }
  }
  return {
    ok: true,
    position: {
      asset: asset.asset,
      assetKey: asset.assetKey,
      state: positionState.position,
      leverage: leverage.value,
      leverageDecimal: leverage.decimal,
      marginMode: marginMode.marginMode as NormalizedScenarioPosition['marginMode'],
    },
  }
}

function normalizeAllocation(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly allocation: IsolatedMarginAllocation }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const kind = ownKind(input)
  if (kind === 'not-applicable' || kind === 'auto-from-leverage') {
    const kindShape = exactPlainObject(input, ['kind'], path)
    if (!kindShape.ok) return kindShape
    return { ok: true, allocation: { kind } }
  }
  const amountShape = exactPlainObject(input, ['kind', 'amount'], path)
  if (kind === 'explicit-margin-delta') {
    if (!amountShape.ok) return amountShape
    const amount = normalizeDecimalAt(
      ownDataValue(amountShape.object, 'amount'),
      `${path}/amount`,
      'signed',
    )
    if (!amount.ok) return amount
    return { ok: true, allocation: { kind: 'explicit-margin-delta', amount: amount.value } }
  }
  const unsupportedShape = exactPlainObject(input, ['kind', 'reason'], path)
  if (kind === 'not-supported') {
    if (!unsupportedShape.ok) return unsupportedShape
    const reason = normalizeMathReason(
      ownDataValue(unsupportedShape.object, 'reason'),
      `${path}/reason`,
    )
    if (!reason.ok) return reason
    return {
      ok: true,
      allocation: {
        kind: 'not-supported',
        reason: reason.reason,
      },
    }
  }
  return {
    ok: false,
    issue: issue(
      'invalid-isolated-margin-allocation',
      `${path}/kind`,
      kind,
      'known allocation kind',
    ),
  }
}

function normalizeMarginEffect(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly effect: LeverageMarginEffect }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const kind = ownKind(input)
  if (
    kind === 'none' ||
    kind === 'preserve-isolated-margin' ||
    kind === 'auto-from-leverage' ||
    kind === 'release-all-isolated-to-cross'
  ) {
    const kindShape = exactPlainObject(input, ['kind'], path)
    if (!kindShape.ok) return kindShape
    return { ok: true, effect: { kind } }
  }
  const amountShape = exactPlainObject(input, ['kind', 'amount'], path)
  if (kind === 'explicit-isolated-margin-delta') {
    if (!amountShape.ok) return amountShape
    const amount = normalizeDecimalAt(
      ownDataValue(amountShape.object, 'amount'),
      `${path}/amount`,
      'signed',
    )
    if (!amount.ok) return amount
    return { ok: true, effect: { kind: 'explicit-isolated-margin-delta', amount: amount.value } }
  }
  const unsupportedShape = exactPlainObject(input, ['kind', 'reason'], path)
  if (kind === 'not-supported') {
    if (!unsupportedShape.ok) return unsupportedShape
    const reason = normalizeMathReason(
      ownDataValue(unsupportedShape.object, 'reason'),
      `${path}/reason`,
    )
    if (!reason.ok) return reason
    return {
      ok: true,
      effect: {
        kind: 'not-supported',
        reason: reason.reason,
      },
    }
  }
  return {
    ok: false,
    issue: issue('invalid-margin-effect', `${path}/kind`, kind, 'known margin effect kind'),
  }
}

function normalizeAction(
  input: unknown,
  path: string,
  markets: ReadonlyMap<string, NormalizedMarket>,
):
  | { readonly ok: true; readonly action: NormalizedAction }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const kind = ownKind(input)
  if (kind === 'cross-account-value-delta') {
    const shape = exactPlainObject(input, ['kind', 'amount'], path)
    if (!shape.ok) return shape
    const amount = normalizeDecimalAt(
      ownDataValue(shape.object, 'amount'),
      `${path}/amount`,
      'signed',
    )
    if (!amount.ok) return amount
    return { ok: true, action: { kind, amount: amount.value, decimal: amount.decimal } }
  }
  if (kind === 'isolated-margin-delta') {
    const shape = exactPlainObject(input, ['kind', 'asset', 'amount'], path)
    if (!shape.ok) return shape
    const asset = normalizeAsset(ownDataValue(shape.object, 'asset'), `${path}/asset`)
    if (!asset.ok) return asset
    if (!markets.has(asset.assetKey))
      return {
        ok: false,
        issue: issue(
          'unknown-market-asset',
          `${path}/asset`,
          asset.assetKey,
          'asset in snapshot.markets',
        ),
      }
    const amount = normalizeDecimalAt(
      ownDataValue(shape.object, 'amount'),
      `${path}/amount`,
      'signed',
    )
    if (!amount.ok) return amount
    return {
      ok: true,
      action: { kind, assetKey: asset.assetKey, amount: amount.value, decimal: amount.decimal },
    }
  }
  if (kind === 'fill') {
    const shape = exactPlainObject(
      input,
      ['kind', 'asset', 'fill', 'isolatedMarginAllocation'],
      path,
    )
    if (!shape.ok) return shape
    const asset = normalizeAsset(ownDataValue(shape.object, 'asset'), `${path}/asset`)
    if (!asset.ok) return asset
    if (!markets.has(asset.assetKey))
      return {
        ok: false,
        issue: issue(
          'unknown-market-asset',
          `${path}/asset`,
          asset.assetKey,
          'asset in snapshot.markets',
        ),
      }
    const fill = normalizeFill(ownDataValue(shape.object, 'fill'), `${path}/fill`)
    if (!fill.ok) return fill
    const allocation = normalizeAllocation(
      ownDataValue(shape.object, 'isolatedMarginAllocation'),
      `${path}/isolatedMarginAllocation`,
    )
    if (!allocation.ok) return allocation
    return {
      ok: true,
      action: {
        kind,
        assetKey: asset.assetKey,
        fill: fill.fill,
        isolatedMarginAllocation: allocation.allocation,
      },
    }
  }
  if (kind === 'set-leverage') {
    const shape = exactPlainObject(
      input,
      ['kind', 'asset', 'targetMode', 'leverage', 'marginEffect'],
      path,
    )
    if (!shape.ok) return shape
    const asset = normalizeAsset(ownDataValue(shape.object, 'asset'), `${path}/asset`)
    if (!asset.ok) return asset
    const market = markets.get(asset.assetKey)
    if (market === undefined)
      return {
        ok: false,
        issue: issue(
          'unknown-market-asset',
          `${path}/asset`,
          asset.assetKey,
          'asset in snapshot.markets',
        ),
      }
    const targetMode = ownDataValue(shape.object, 'targetMode')
    if (targetMode !== 'cross' && targetMode !== 'isolated')
      return {
        ok: false,
        issue: issue('invalid-target-mode', `${path}/targetMode`, targetMode, 'cross or isolated'),
      }
    const leverage = normalizeDecimalAt(
      ownDataValue(shape.object, 'leverage'),
      `${path}/leverage`,
      'positive',
    )
    if (!leverage.ok) return leverage
    if (!leverage.decimal.isInteger() || leverage.decimal.greaterThan(market.maxLeverageDecimal)) {
      return {
        ok: false,
        issue: issue(
          'invalid-leverage',
          `${path}/leverage`,
          leverage.value,
          `integer <= ${market.maxLeverage}`,
        ),
      }
    }
    const effect = normalizeMarginEffect(
      ownDataValue(shape.object, 'marginEffect'),
      `${path}/marginEffect`,
    )
    if (!effect.ok) return effect
    return {
      ok: true,
      action: {
        kind,
        assetKey: asset.assetKey,
        targetMode,
        leverage: leverage.value,
        leverageDecimal: leverage.decimal,
        marginEffect: effect.effect,
      },
    }
  }
  return {
    ok: false,
    issue: issue('invalid-action-kind', `${path}/kind`, kind, 'known scenario action'),
  }
}

export function normalizeInput(
  input: unknown,
):
  | { readonly ok: true; readonly input: NormalizedInput }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['snapshot', 'actions'], '')
  if (!shape.ok) return shape
  const snapshot = exactPlainObject(
    ownDataValue(shape.object, 'snapshot'),
    ['crossAccountValue', 'positions', 'markets'],
    '/snapshot',
  )
  if (!snapshot.ok) return snapshot
  const crossAccountValue = normalizeDecimalAt(
    ownDataValue(snapshot.object, 'crossAccountValue'),
    '/snapshot/crossAccountValue',
    'signed',
  )
  if (!crossAccountValue.ok) return crossAccountValue
  const marketsArray = exactPlainArray(
    ownDataValue(snapshot.object, 'markets'),
    '/snapshot/markets',
    { maxLength: 5000 },
  )
  if (!marketsArray.ok) return marketsArray
  const markets = new Map<string, NormalizedMarket>()
  for (let index = 0; index < marketsArray.values.length; index += 1) {
    const market = normalizeMarket(marketsArray.values[index], `/snapshot/markets/${index}`)
    if (!market.ok) return market
    if (markets.has(market.market.assetKey)) {
      return {
        ok: false,
        issue: issue(
          'duplicate-market-asset',
          `/snapshot/markets/${index}/asset`,
          market.market.assetKey,
          'unique market asset',
        ),
      }
    }
    markets.set(market.market.assetKey, market.market)
  }
  const positionsArray = exactPlainArray(
    ownDataValue(snapshot.object, 'positions'),
    '/snapshot/positions',
    { maxLength: 5000 },
  )
  if (!positionsArray.ok) return positionsArray
  const positions: NormalizedScenarioPosition[] = []
  const seenPositions = new Set<string>()
  for (let index = 0; index < positionsArray.values.length; index += 1) {
    const position = normalizeScenarioPosition(
      positionsArray.values[index],
      `/snapshot/positions/${index}`,
      markets,
    )
    if (!position.ok) return position
    if (seenPositions.has(position.position.assetKey)) {
      return {
        ok: false,
        issue: issue(
          'duplicate-position-asset',
          `/snapshot/positions/${index}/asset`,
          position.position.assetKey,
          'unique position asset',
        ),
      }
    }
    seenPositions.add(position.position.assetKey)
    positions.push(position.position)
  }
  const actionsArray = exactPlainArray(ownDataValue(shape.object, 'actions'), '/actions', {
    maxLength: 2000,
  })
  if (!actionsArray.ok) return actionsArray
  const actions: NormalizedAction[] = []
  for (let index = 0; index < actionsArray.values.length; index += 1) {
    const action = normalizeAction(actionsArray.values[index], `/actions/${index}`, markets)
    if (!action.ok) return action
    actions.push(action.action)
  }
  return {
    ok: true,
    input: {
      crossAccountValue: crossAccountValue.value,
      crossAccountValueDecimal: crossAccountValue.decimal,
      markets,
      positions,
      actions,
    },
  }
}
