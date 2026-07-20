import { Decimal40 } from '../core/decimal.js'
import { computePerpLiquidationPriceNormalized } from '../liquidation/internal.js'
import type {
  NormalizedLiquidationInput,
  NormalizedLiquidationPosition,
} from '../liquidation/types.js'
import {
  computePerpInitialMarginNormalized,
  computePerpMaintenanceMarginNormalized,
  computePerpTransferRequirement,
} from '../margin/internal.js'
import type { NormalizedPerpMarginPosition } from '../margin/types.js'
import type { NormalizedPosition, PerpPositionState } from '../positions/types.js'
import { decimalString } from './result.js'
import type {
  AccountMarginView,
  DecimalValue,
  NormalizedMarket,
  NormalizedScenarioPosition,
  PerpScenarioMarginMode,
  WorkingState,
} from './types.js'

function publicState(position: NormalizedPosition): PerpPositionState {
  if (position.kind === 'flat') return { kind: 'flat' }
  return { kind: 'open', signedSize: position.signedSize, entryPrice: position.entryPrice }
}

function publicMarginMode(position: NormalizedScenarioPosition): PerpScenarioMarginMode {
  if (position.marginMode.kind === 'cross') return { kind: 'cross' }
  return {
    kind: 'isolated',
    isolatedMarginValue: position.marginMode.isolatedMarginValue,
    marginRemoval: position.marginMode.marginRemoval,
  }
}

function normalizedMarginPosition(
  position: NormalizedScenarioPosition,
  market: NormalizedMarket,
): NormalizedPerpMarginPosition | null {
  if (position.state.kind === 'flat') return null
  return {
    asset: position.asset,
    assetKey: position.assetKey,
    signedSize: position.state.signedSize as NormalizedPerpMarginPosition['signedSize'],
    signedSizeDecimal: position.state.signedSizeDecimal,
    absoluteSizeDecimal: position.state.signedSizeDecimal.abs(),
    markPrice: market.markPrice as NormalizedPerpMarginPosition['markPrice'],
    markPriceDecimal: market.markPriceDecimal,
    leverage: {
      value: position.leverage as NormalizedPerpMarginPosition['leverage']['value'],
      valueDecimal: position.leverageDecimal,
    },
    marginMode: position.marginMode as NormalizedPerpMarginPosition['marginMode'],
    marginTiers: market.marginTiers,
  }
}

export function positionMargin(
  position: NormalizedScenarioPosition,
  market: NormalizedMarket,
): {
  readonly positionValue: DecimalValue
  readonly initialMargin: DecimalValue
  readonly maintenanceMargin: DecimalValue
} {
  const normalized = normalizedMarginPosition(position, market)
  if (normalized === null) {
    const zero = new Decimal40(0)
    return { positionValue: zero, initialMargin: zero, maintenanceMargin: zero }
  }
  const initial = computePerpInitialMarginNormalized(normalized)
  const maintenance = computePerpMaintenanceMarginNormalized(normalized)
  return {
    positionValue: initial.positionValueDecimal,
    initialMargin: initial.initialMarginDecimal,
    maintenanceMargin: maintenance.maintenanceMarginDecimal,
  }
}

function liquidationPrice(
  target: NormalizedScenarioPosition,
  state: WorkingState,
  markets: ReadonlyMap<string, NormalizedMarket>,
): string | null {
  if (target.state.kind === 'flat') return null
  const positions: NormalizedLiquidationPosition[] = []
  let targetPositionIndex = -1
  for (const position of state.positions.values()) {
    if (position.state.kind === 'flat') continue
    const market = markets.get(position.assetKey)
    if (market === undefined) {
      throw new Error(
        `normalized scenario invariant failed at /liquidation/${target.assetKey}/positions/${position.assetKey}/market`,
      )
    }
    if (position.assetKey === target.assetKey) targetPositionIndex = positions.length
    positions.push({
      asset: position.asset,
      assetKey: position.assetKey,
      signedSize: position.state.signedSize,
      signedSizeDecimal: position.state.signedSizeDecimal,
      entryPrice: position.state.entryPrice,
      markPrice: market.markPrice,
      markPriceDecimal: market.markPriceDecimal,
      marginMode: position.marginMode,
      marginTiers: market.marginTiers,
    })
  }
  if (targetPositionIndex < 0) {
    throw new Error(
      `normalized scenario invariant failed at /liquidation/${target.assetKey}/target`,
    )
  }
  const input: NormalizedLiquidationInput = {
    targetAsset: target.asset,
    targetAssetKey: target.assetKey,
    crossAccountValue: decimalString(state.crossAccountValue),
    crossAccountValueDecimal: state.crossAccountValue,
    positions,
    targetPositionIndex,
  }
  return computePerpLiquidationPriceNormalized(input).root?.price.toFixed() ?? null
}

export function accountView(
  state: WorkingState,
  markets: ReadonlyMap<string, NormalizedMarket>,
): AccountMarginView {
  const positions = [...state.positions.values()]
  let crossPositionValue = new Decimal40(0)
  let crossInitialMargin = new Decimal40(0)
  let crossMaintenanceMargin = new Decimal40(0)
  const views = positions.map((position) => {
    const market = markets.get(position.assetKey)
    if (market === undefined) throw new Error('market already validated')
    const margin = positionMargin(position, market)
    if (position.marginMode.kind === 'cross') {
      crossPositionValue = crossPositionValue.plus(margin.positionValue)
      crossInitialMargin = crossInitialMargin.plus(margin.initialMargin)
      crossMaintenanceMargin = crossMaintenanceMargin.plus(margin.maintenanceMargin)
    }
    return {
      asset: position.asset,
      assetKey: position.assetKey,
      state: publicState(position.state),
      leverage: position.leverage,
      marginMode: publicMarginMode(position),
      markPrice: market.markPrice,
      positionValue: decimalString(margin.positionValue),
      initialMargin: decimalString(margin.initialMargin),
      maintenanceMargin: decimalString(margin.maintenanceMargin),
    }
  })
  const liquidation: Record<string, string | null> = {}
  for (const position of positions) {
    liquidation[position.assetKey] = liquidationPrice(position, state, markets)
  }
  return {
    cross: {
      accountValue: decimalString(state.crossAccountValue),
      positionValue: decimalString(crossPositionValue),
      initialMargin: decimalString(crossInitialMargin),
      transferMarginRequirement: decimalString(
        computePerpTransferRequirement(crossInitialMargin, crossPositionValue),
      ),
      maintenanceMargin: decimalString(crossMaintenanceMargin),
      maintenanceMarginAvailable: decimalString(
        state.crossAccountValue.minus(crossMaintenanceMargin),
      ),
    },
    positions: views,
    liquidation: { byAsset: liquidation },
  }
}
