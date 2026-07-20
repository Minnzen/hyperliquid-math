import { Decimal40 } from '../core/decimal.js'
import type { MathResult, RoundingDecision } from '../model/index.js'
import {
  convertInputs,
  dustAllocationInputs,
  dustEligibilityInputs,
  orderInputs,
  portfolioInputs,
  positionEventTrace,
  sourceRefs,
  spotTrace,
} from './trace.js'
import type {
  CalculateSpotOrderDeltasInput,
  CalculateSpotPortfolioValueInput,
  ConvertSpotTokenUnitsInput,
  EvaluateSpotDustEligibilityInput,
  NormalizedProjectSpotPositionEventInput,
  ProjectSpotDustAllocationInput,
  ProjectSpotPositionEventInput,
  SpotDustAllocation,
  SpotDustCheck,
  SpotDustEligibility,
  SpotOrderDeltas,
  SpotPortfolioTokenValue,
  SpotPortfolioValue,
  SpotPosition,
  SpotPositionEventProjection,
  SpotTokenUnitConversion,
} from './types.js'
import {
  humanToMinimalString,
  lotSizeHumanString,
  lotSizeWeiString,
  minimalToHumanString,
} from './units.js'
import {
  normalizeCalculateSpotPortfolioValueInput,
  normalizeConvertSpotTokenUnitsInput,
  normalizeEvaluateSpotDustEligibilityInput,
  normalizeProjectSpotDustAllocationInput,
  normalizeProjectSpotPositionEventInput,
  normalizeSpotOrderDeltasInput,
  reason,
} from './validation.js'

export type {
  CalculateSpotOrderDeltasInput,
  CalculateSpotPortfolioValueInput,
  ConvertSpotTokenUnitsInput,
  EvaluateSpotDustEligibilityInput,
  ProjectSpotDustAllocationInput,
  ProjectSpotPositionEventInput,
  SpotDustAllocation,
  SpotDustCheck,
  SpotDustEligibility,
  SpotOrderDeltas,
  SpotPortfolioBalanceInput,
  SpotPortfolioTokenValue,
  SpotPortfolioValue,
  SpotPosition,
  SpotPositionEvent,
  SpotPositionEventProjection,
  SpotSide,
  SpotTokenUnitConversion,
} from './types.js'

/**
 * Converts between human token amounts and integer minimal units by shifting `weiDecimals`
 * places: `minimal-to-human` returns `value / 10 ** weiDecimals`; `human-to-minimal` requires the
 * product to be an integer — fractional minimal units are `invalid-input`, never rounded.
 *
 * @public
 */
export function convertSpotTokenUnits(
  input: ConvertSpotTokenUnitsInput,
): MathResult<SpotTokenUnitConversion> {
  const normalized = normalizeConvertSpotTokenUnitsInput(input)
  if (!normalized.ok) {
    return {
      value: { status: 'invalid-input', issues: [normalized.issue] },
      trace: spotTrace(
        'hl.spot.units.convert',
        'stable',
        {},
        {
          status: 'incomplete',
          reason: reason(normalized.issue.code, normalized.issue.path),
        },
        sourceRefs.units,
      ),
    }
  }

  const converted =
    normalized.value.direction === 'human-to-minimal'
      ? humanToMinimalString(normalized.value.value, normalized.value.weiDecimals)
      : minimalToHumanString(normalized.value.value, normalized.value.weiDecimals)
  if (!converted.ok) {
    return {
      value: { status: 'invalid-input', issues: [converted.issue] },
      trace: spotTrace(
        'hl.spot.units.convert',
        'stable',
        {},
        { status: 'incomplete', reason: reason(converted.issue.code, converted.issue.path) },
        sourceRefs.units,
      ),
    }
  }

  return {
    value: { status: 'ok', data: { value: converted.value } },
    trace: spotTrace(
      'hl.spot.units.convert',
      'stable',
      convertInputs(normalized.value),
      { status: 'complete' },
      sourceRefs.units,
      [{ kind: 'frozen-input', path: '/weiDecimals', value: 'caller-provided-token-metadata' }],
      [
        {
          stepId: 'unit-conversion',
          inputs: convertInputs(normalized.value),
          output: converted.value,
        },
      ],
    ),
  }
}

/**
 * Computes a spot order's balance movements in human units: `notional = price * baseSize`, with a
 * buy at `+base / -quote` and a sell at `-base / +quote`. Fees, holds, partial fills, and server
 * acceptance are outside this deterministic delta.
 *
 * @public
 */
export function calculateSpotOrderDeltas(
  input: CalculateSpotOrderDeltasInput,
): MathResult<SpotOrderDeltas> {
  const normalized = normalizeSpotOrderDeltasInput(input)
  if (!normalized.ok) {
    return {
      value: { status: 'invalid-input', issues: [normalized.issue] },
      trace: spotTrace(
        'hl.spot.order-deltas.calculate',
        'stable',
        {},
        {
          status: 'incomplete',
          reason: reason(normalized.issue.code, normalized.issue.path),
        },
        sourceRefs.orderDeltas,
      ),
    }
  }

  const notional = normalized.value.priceDecimal.mul(normalized.value.baseSizeDecimal)
  const data = {
    notional: notional.toFixed(),
    baseDelta:
      normalized.value.side === 'buy'
        ? normalized.value.baseSize
        : normalized.value.baseSizeDecimal.neg().toFixed(),
    quoteDelta: normalized.value.side === 'buy' ? notional.neg().toFixed() : notional.toFixed(),
  }

  return {
    value: { status: 'ok', data },
    trace: spotTrace(
      'hl.spot.order-deltas.calculate',
      'stable',
      orderInputs(normalized.value),
      { status: 'complete' },
      sourceRefs.orderDeltas,
      [{ kind: 'frozen-input', path: '', value: 'caller-provided-spot-order-input' }],
      [
        {
          stepId: 'notional',
          inputs: { price: normalized.value.price, baseSize: normalized.value.baseSize },
          output: data.notional,
        },
        { stepId: 'signed-deltas', inputs: { side: normalized.value.side }, output: data },
      ],
    ),
  }
}

function normalizedPublicPosition(input: NormalizedProjectSpotPositionEventInput): SpotPosition {
  const position = input.position
  if (position.kind === 'flat') return { kind: 'flat' }
  return { kind: 'open', balance: position.balance, entryPrice: position.entryPrice }
}

function openPosition(balance: string, entryPrice: string): SpotPosition {
  return { kind: 'open', balance, entryPrice }
}

function zeroProjection(
  classification: SpotPositionEventProjection['classification'],
  previousState: SpotPosition,
  nextState: SpotPosition,
  openedSize: string,
  closedSize: string,
): Omit<
  SpotPositionEventProjection,
  'grossRealizedPnl' | 'feeAmount' | 'feeAccountValueDelta' | 'closedPnl'
> {
  return {
    classification,
    previousState,
    nextState,
    openedSize,
    closedSize,
  }
}

/**
 * Applies one inventory event to a spot position: buys open/increase with size-weighted entry;
 * sells realize `(price - entryPrice) * size` with `closedPnl = gross - feeQuoteAmount`
 * (overselling the balance is `invalid-input`); transfers open/close at the supplied mark;
 * genesis opens at the official `10000 / maxSupply` market-cap basis; and
 * `initialize-from-existing-balance` seeds a flat state from a pre-existing balance.
 *
 * @public
 */
export function projectSpotPositionEvent(
  input: ProjectSpotPositionEventInput,
): MathResult<SpotPositionEventProjection> {
  const normalized = normalizeProjectSpotPositionEventInput(input)
  if (!normalized.ok) {
    return {
      value: { status: 'invalid-input', issues: [normalized.issue] },
      trace: positionEventTrace(undefined, {
        status: 'incomplete',
        reason: reason(normalized.issue.code, normalized.issue.path),
      }),
    }
  }

  const previousState = normalizedPublicPosition(normalized.value)
  const event = normalized.value.event
  const position = normalized.value.position
  let data: SpotPositionEventProjection
  const rounding: RoundingDecision[] = []

  if (event.kind === 'buy') {
    const feeAccountValueDelta = event.feeQuoteAmountDecimal.neg()
    const closedPnl = feeAccountValueDelta
    let nextState: SpotPosition
    if (position.kind === 'flat') {
      nextState = openPosition(event.size, event.price)
    } else {
      const nextBalance = position.balanceDecimal.plus(event.sizeDecimal)
      const nextEntryPrice = position.balanceDecimal
        .mul(position.entryPriceDecimal)
        .plus(event.sizeDecimal.mul(event.priceDecimal))
        .div(nextBalance)
      nextState = openPosition(nextBalance.toFixed(), nextEntryPrice.toFixed())
      rounding.push({
        path: '/value/data/nextState/entryPrice',
        input: `(${position.balance}*${position.entryPrice}+${event.size}*${event.price})/(${position.balance}+${event.size})`,
        output: nextEntryPrice.toFixed(),
        mode: 'half-even',
        reasonCode: 'decimal40-division',
      })
    }
    data = {
      ...zeroProjection(
        position.kind === 'flat' ? 'open' : 'increase',
        previousState,
        nextState,
        event.size,
        '0',
      ),
      grossRealizedPnl: '0',
      feeAmount: event.feeQuoteAmount,
      feeAccountValueDelta: feeAccountValueDelta.toFixed(),
      closedPnl: closedPnl.toFixed(),
    }
  } else if (event.kind === 'sell') {
    if (position.kind === 'flat' || event.sizeDecimal.gt(position.balanceDecimal)) {
      const invalidIssue = {
        code: 'spot-oversell',
        path: '/event/size',
        actual: event.size,
        expected: 'less than or equal to current spot balance',
      }
      return {
        value: { status: 'invalid-input', issues: [invalidIssue] },
        trace: positionEventTrace(undefined, {
          status: 'incomplete',
          reason: reason(invalidIssue.code, invalidIssue.path),
        }),
      }
    }
    const nextBalance = position.balanceDecimal.minus(event.sizeDecimal)
    const gross = event.priceDecimal.minus(position.entryPriceDecimal).mul(event.sizeDecimal)
    const feeAccountValueDelta = event.feeQuoteAmountDecimal.neg()
    const closedPnl = gross.minus(event.feeQuoteAmountDecimal)
    data = {
      ...zeroProjection(
        nextBalance.isZero() ? 'close' : 'reduce',
        previousState,
        nextBalance.isZero()
          ? { kind: 'flat' }
          : openPosition(nextBalance.toFixed(), position.entryPrice),
        '0',
        event.size,
      ),
      grossRealizedPnl: gross.toFixed(),
      feeAmount: event.feeQuoteAmount,
      feeAccountValueDelta: feeAccountValueDelta.toFixed(),
      closedPnl: closedPnl.toFixed(),
    }
  } else if (event.kind === 'transfer') {
    if (event.direction === 'in') {
      let nextState: SpotPosition
      if (position.kind === 'flat') {
        nextState = openPosition(event.size, event.markPrice)
      } else {
        const nextBalance = position.balanceDecimal.plus(event.sizeDecimal)
        const nextEntryPrice = position.balanceDecimal
          .mul(position.entryPriceDecimal)
          .plus(event.sizeDecimal.mul(event.markPriceDecimal))
          .div(nextBalance)
        nextState = openPosition(nextBalance.toFixed(), nextEntryPrice.toFixed())
        rounding.push({
          path: '/value/data/nextState/entryPrice',
          input: `(${position.balance}*${position.entryPrice}+${event.size}*${event.markPrice})/(${position.balance}+${event.size})`,
          output: nextEntryPrice.toFixed(),
          mode: 'half-even',
          reasonCode: 'decimal40-division',
        })
      }
      data = {
        ...zeroProjection('transfer-in', previousState, nextState, event.size, '0'),
        grossRealizedPnl: '0',
        feeAmount: '0',
        feeAccountValueDelta: '0',
        closedPnl: '0',
      }
    } else {
      if (position.kind === 'flat' || event.sizeDecimal.gt(position.balanceDecimal)) {
        const invalidIssue = {
          code: 'spot-oversell',
          path: '/event/size',
          actual: event.size,
          expected: 'less than or equal to current spot balance',
        }
        return {
          value: { status: 'invalid-input', issues: [invalidIssue] },
          trace: positionEventTrace(undefined, {
            status: 'incomplete',
            reason: reason(invalidIssue.code, invalidIssue.path),
          }),
        }
      }
      const nextBalance = position.balanceDecimal.minus(event.sizeDecimal)
      const gross = event.markPriceDecimal.minus(position.entryPriceDecimal).mul(event.sizeDecimal)
      data = {
        ...zeroProjection(
          'transfer-out',
          previousState,
          nextBalance.isZero()
            ? { kind: 'flat' }
            : openPosition(nextBalance.toFixed(), position.entryPrice),
          '0',
          event.size,
        ),
        grossRealizedPnl: gross.toFixed(),
        feeAmount: '0',
        feeAccountValueDelta: '0',
        closedPnl: gross.toFixed(),
      }
    }
  } else if (event.kind === 'genesis') {
    const genesisEntryPriceDecimal = new Decimal40(10000).div(event.maxSupplyDecimal)
    const genesisEntryPrice = genesisEntryPriceDecimal.toFixed()
    rounding.push({
      path:
        position.kind === 'flat'
          ? '/value/data/nextState/entryPrice'
          : '/intermediates/genesisEntryPrice',
      input: `10000/${event.maxSupply}`,
      output: genesisEntryPrice,
      mode: 'half-even',
      reasonCode: 'decimal40-division',
    })
    let nextState: SpotPosition
    if (position.kind === 'flat') {
      nextState = openPosition(event.size, genesisEntryPrice)
    } else {
      const nextBalance = position.balanceDecimal.plus(event.sizeDecimal)
      const nextEntryPrice = position.balanceDecimal
        .mul(position.entryPriceDecimal)
        .plus(event.sizeDecimal.mul(genesisEntryPriceDecimal))
        .div(nextBalance)
      nextState = openPosition(nextBalance.toFixed(), nextEntryPrice.toFixed())
      rounding.push({
        path: '/value/data/nextState/entryPrice',
        input: `(${position.balance}*${position.entryPrice}+${event.size}*${genesisEntryPrice})/(${position.balance}+${event.size})`,
        output: nextEntryPrice.toFixed(),
        mode: 'half-even',
        reasonCode: 'decimal40-division',
      })
    }
    data = {
      ...zeroProjection('genesis', previousState, nextState, event.size, '0'),
      grossRealizedPnl: '0',
      feeAmount: '0',
      feeAccountValueDelta: '0',
      closedPnl: '0',
    }
  } else {
    if (position.kind !== 'flat') {
      const invalidIssue = {
        code: 'spot-initialization-requires-flat',
        path: '/position/kind',
        actual: position.kind,
        expected: 'flat position',
      }
      return {
        value: { status: 'invalid-input', issues: [invalidIssue] },
        trace: positionEventTrace(undefined, {
          status: 'incomplete',
          reason: reason(invalidIssue.code, invalidIssue.path),
        }),
      }
    }
    const nextState = openPosition(event.balance, event.eventPrice)
    data = {
      ...zeroProjection(
        'initialize-from-existing-balance',
        previousState,
        nextState,
        event.balance,
        '0',
      ),
      grossRealizedPnl: '0',
      feeAmount: '0',
      feeAccountValueDelta: '0',
      closedPnl: '0',
    }
  }

  return {
    value: { status: 'ok', data },
    trace: positionEventTrace(normalized.value, { status: 'complete' }, [], rounding),
  }
}

/**
 * Values up to 1024 token balances at frozen marks: per token
 * `tokenValue = balance * markPrice`, `entryNotional = balance * entryPrice`,
 * `unrealizedPnl = tokenValue - entryNotional`, plus portfolio aggregates of all three.
 * Duplicate `tokenKey` values are `invalid-input`; token discovery and mark freshness are the
 * caller's.
 *
 * @public
 */
export function calculateSpotPortfolioValue(
  input: CalculateSpotPortfolioValueInput,
): MathResult<SpotPortfolioValue> {
  const normalized = normalizeCalculateSpotPortfolioValueInput(input)
  if (!normalized.ok) {
    return {
      value: { status: 'invalid-input', issues: [normalized.issue] },
      trace: spotTrace(
        'hl.spot.portfolio-value.calculate',
        'stable',
        {},
        {
          status: 'incomplete',
          reason: reason(normalized.issue.code, normalized.issue.path),
        },
        sourceRefs.portfolio,
      ),
    }
  }

  const tokens: SpotPortfolioTokenValue[] = normalized.value.balances.map((balance) => {
    const tokenValue = balance.balanceDecimal.mul(balance.markPriceDecimal)
    const entryNotional = balance.balanceDecimal.mul(balance.entryPriceDecimal)
    return {
      tokenKey: balance.tokenKey,
      balance: balance.balance,
      entryPrice: balance.entryPrice,
      markPrice: balance.markPrice,
      tokenValue: tokenValue.toFixed(),
      entryNotional: entryNotional.toFixed(),
      unrealizedPnl: tokenValue.minus(entryNotional).toFixed(),
    }
  })
  const data = {
    tokens,
    portfolioValue: tokens
      .reduce((sum, token) => sum.plus(token.tokenValue), new Decimal40(0))
      .toFixed(),
    entryNotional: tokens
      .reduce((sum, token) => sum.plus(token.entryNotional), new Decimal40(0))
      .toFixed(),
    unrealizedPnl: tokens
      .reduce((sum, token) => sum.plus(token.unrealizedPnl), new Decimal40(0))
      .toFixed(),
  }

  return {
    value: { status: 'ok', data },
    trace: spotTrace(
      'hl.spot.portfolio-value.calculate',
      'stable',
      portfolioInputs(normalized.value),
      { status: 'complete' },
      sourceRefs.portfolio,
      [
        {
          kind: 'frozen-input',
          path: '/balances/*/markPrice',
          value: 'caller-provided-unverified-mark',
        },
      ],
    ),
  }
}

/**
 * Evaluates the official dust predicate at a frozen mid: a balance is eligible iff
 * `balance < lotSize` and `balance * midPrice <= usdThreshold`, where
 * `lotSize = 10 ** (-szDecimals)` (`lotSizeWei = 10 ** (weiDecimals - szDecimals)`).
 * The daily dust service may still skip execution; only the deterministic predicate is computed.
 *
 * @public
 */
export function evaluateSpotDustEligibility(
  input: EvaluateSpotDustEligibilityInput,
): MathResult<SpotDustEligibility> {
  const normalized = normalizeEvaluateSpotDustEligibilityInput(input)
  if (!normalized.ok) {
    return {
      value: { status: 'invalid-input', issues: [normalized.issue] },
      trace: spotTrace(
        'hl.spot.dust-eligibility.evaluate',
        'stable',
        {},
        {
          status: 'incomplete',
          reason: reason(normalized.issue.code, normalized.issue.path),
        },
        sourceRefs.dustEligibility,
      ),
    }
  }

  const lotSizeWei = lotSizeWeiString(normalized.value.weiDecimals, normalized.value.szDecimals)
  const lotSize = lotSizeHumanString(normalized.value.szDecimals)
  const notionalUsd = normalized.value.balanceDecimal.mul(normalized.value.midPriceDecimal)
  const balanceBelowLot = normalized.value.balanceDecimal.lt(lotSize)
  const belowThreshold = notionalUsd.lte(normalized.value.usdThresholdDecimal)
  const checks: SpotDustCheck[] = [
    balanceBelowLot
      ? { status: 'satisfied', ruleId: 'hl.spot.dust.balance-below-lot' }
      : {
          status: 'violated',
          ruleId: 'hl.spot.dust.balance-below-lot',
          violation: {
            ruleId: 'hl.spot.dust.balance-below-lot',
            code: 'balance-not-below-lot',
            path: '/balance',
            actual: normalized.value.balance,
            limit: lotSize,
          },
        },
    belowThreshold
      ? { status: 'satisfied', ruleId: 'hl.spot.dust.notional-threshold' }
      : {
          status: 'violated',
          ruleId: 'hl.spot.dust.notional-threshold',
          violation: {
            ruleId: 'hl.spot.dust.notional-threshold',
            code: 'notional-above-threshold',
            path: '/usdThreshold',
            actual: notionalUsd.toFixed(),
            limit: normalized.value.usdThreshold,
          },
        },
  ]
  const data = {
    lotSizeWei,
    lotSize,
    notionalUsd: notionalUsd.toFixed(),
    eligible: balanceBelowLot && belowThreshold,
    checks,
  }

  return {
    value: { status: 'ok', data },
    trace: spotTrace(
      'hl.spot.dust-eligibility.evaluate',
      'stable',
      dustEligibilityInputs(normalized.value),
      { status: 'complete' },
      sourceRefs.dustEligibility,
      [
        { kind: 'frozen-input', path: '/weiDecimals', value: 'caller-provided-token-metadata' },
        { kind: 'frozen-input', path: '/szDecimals', value: 'caller-provided-token-metadata' },
        { kind: 'frozen-input', path: '/midPrice', value: 'caller-provided-unverified-mid' },
      ],
    ),
  }
}

/**
 * Projects one user's share of a caller-supplied aggregate dust outcome: below one lot the mode
 * is `burn` with zero proceeds; otherwise `allocationRatio = userDustSize / aggregateDustSize`
 * and `userProceeds = executedProceeds * allocationRatio`. It does not decide whether HyperCore
 * sells or burns, nor reproduce server allocation rounding (experimental maturity).
 *
 * @public
 */
export function projectSpotDustAllocation(
  input: ProjectSpotDustAllocationInput,
): MathResult<SpotDustAllocation> {
  const normalized = normalizeProjectSpotDustAllocationInput(input)
  if (!normalized.ok) {
    return {
      value: { status: 'invalid-input', issues: [normalized.issue] },
      trace: spotTrace(
        'hl.spot.dust-allocation.project',
        'experimental',
        {},
        {
          status: 'incomplete',
          reason: reason(normalized.issue.code, normalized.issue.path),
        },
        sourceRefs.dustAllocation,
      ),
    }
  }

  const burnMode = normalized.value.aggregateDustSizeDecimal.lt(
    normalized.value.aggregateLotSizeDecimal,
  )
  let allocationRatio: InstanceType<typeof Decimal40> | null = null
  let data: SpotDustAllocation
  if (burnMode) {
    data = { mode: 'burn', allocationRatio: '0', userProceeds: '0' }
  } else {
    allocationRatio = normalized.value.userDustSizeDecimal.div(
      normalized.value.aggregateDustSizeDecimal,
    )
    data = {
      mode: 'converted',
      allocationRatio: allocationRatio.toFixed(),
      userProceeds: normalized.value.executedProceedsDecimal.mul(allocationRatio).toFixed(),
    }
  }

  return {
    value: { status: 'ok', data },
    trace: spotTrace(
      'hl.spot.dust-allocation.project',
      'experimental',
      dustAllocationInputs(normalized.value),
      { status: 'complete' },
      sourceRefs.dustAllocation,
      [
        {
          kind: 'frozen-input',
          path: '/executedProceeds',
          value: 'caller-provided-aggregate-sale-outcome',
        },
      ],
      [],
      allocationRatio === null
        ? []
        : [
            {
              path: '/value/data/allocationRatio',
              input: `${normalized.value.userDustSize}/${normalized.value.aggregateDustSize}`,
              output: allocationRatio.toFixed(),
              mode: 'half-even',
              reasonCode: 'decimal40-division',
            },
          ],
    ),
  }
}
