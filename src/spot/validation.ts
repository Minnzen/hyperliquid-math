import { Decimal40 } from '../core/decimal.js'
import {
  exactPlainArray,
  exactPlainObject,
  isPlainObject,
  issue,
  normalizeDecimalAt,
  ownDataValue,
  type ValidationIssue,
} from '../core/validation.js'
import type { MathReason } from '../model/index.js'
import type {
  NormalizedCalculateSpotPortfolioValueInput,
  NormalizedConvertSpotTokenUnitsInput,
  NormalizedEvaluateSpotDustEligibilityInput,
  NormalizedProjectSpotDustAllocationInput,
  NormalizedProjectSpotPositionEventInput,
  NormalizedSpotEvent,
  NormalizedSpotOrderDeltasInput,
  NormalizedSpotPortfolioBalance,
  NormalizedSpotPosition,
} from './types.js'

export function reason(code: string, path: string): MathReason {
  return { code, path }
}

function normalizeSafeIntegerRange(
  input: unknown,
  path: string,
  min: number,
  max: number,
):
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max) {
    return {
      ok: false,
      issue: issue(
        'invalid-safe-integer-range',
        path,
        input,
        `safe integer in range ${min}..${max}`,
      ),
    }
  }
  return { ok: true, value: input }
}

function decimal(input: unknown, path: string, mode: 'signed' | 'non-negative' | 'positive') {
  return normalizeDecimalAt(input, path, mode)
}

function normalizePosition(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly position: NormalizedSpotPosition }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const flat = exactPlainObject(input, ['kind'], path)
  if (flat.ok && ownDataValue(flat.object, 'kind') === 'flat')
    return { ok: true, position: { kind: 'flat' } }

  const open = exactPlainObject(input, ['kind', 'balance', 'entryPrice'], path)
  if (!open.ok) return open
  if (ownDataValue(open.object, 'kind') !== 'open') {
    return {
      ok: false,
      issue: issue(
        'invalid-position-kind',
        `${path}/kind`,
        ownDataValue(open.object, 'kind'),
        'flat or open',
      ),
    }
  }
  const balance = decimal(ownDataValue(open.object, 'balance'), `${path}/balance`, 'positive')
  if (!balance.ok) return balance
  const entryPrice = decimal(
    ownDataValue(open.object, 'entryPrice'),
    `${path}/entryPrice`,
    'positive',
  )
  if (!entryPrice.ok) return entryPrice
  return {
    ok: true,
    position: {
      kind: 'open',
      balance: balance.value,
      balanceDecimal: balance.decimal,
      entryPrice: entryPrice.value,
      entryPriceDecimal: entryPrice.decimal,
    },
  }
}

function normalizeTradeEvent(
  input: unknown,
  path: string,
  kind: 'buy' | 'sell',
):
  | {
      readonly ok: true
      readonly event: Extract<NormalizedSpotEvent, { readonly kind: 'buy' | 'sell' }>
    }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['kind', 'size', 'price', 'feeQuoteAmount'], path)
  if (!shape.ok) return shape
  const size = decimal(ownDataValue(shape.object, 'size'), `${path}/size`, 'positive')
  if (!size.ok) return size
  const price = decimal(ownDataValue(shape.object, 'price'), `${path}/price`, 'positive')
  if (!price.ok) return price
  const feeQuoteAmount = decimal(
    ownDataValue(shape.object, 'feeQuoteAmount'),
    `${path}/feeQuoteAmount`,
    'signed',
  )
  if (!feeQuoteAmount.ok) return feeQuoteAmount
  return {
    ok: true,
    event: {
      kind,
      size: size.value,
      sizeDecimal: size.decimal,
      price: price.value,
      priceDecimal: price.decimal,
      feeQuoteAmount: feeQuoteAmount.value,
      feeQuoteAmountDecimal: feeQuoteAmount.decimal,
    },
  }
}

function normalizeEvent(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly event: NormalizedSpotEvent }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  let kind: unknown
  try {
    if (!isPlainObject(input)) {
      return {
        ok: false,
        issue: issue('invalid-input-shape', path, input, 'plain data object'),
      }
    }
    kind = ownDataValue(input, 'kind')
  } catch {
    return {
      ok: false,
      issue: issue('invalid-input-shape', path, 'uninspectable-object', 'plain data object'),
    }
  }
  if (kind === 'buy' || kind === 'sell') return normalizeTradeEvent(input, path, kind)

  if (kind === 'transfer') {
    const shape = exactPlainObject(input, ['kind', 'size', 'markPrice', 'direction'], path)
    if (!shape.ok) return shape
    const size = decimal(ownDataValue(shape.object, 'size'), `${path}/size`, 'positive')
    if (!size.ok) return size
    const markPrice = decimal(
      ownDataValue(shape.object, 'markPrice'),
      `${path}/markPrice`,
      'positive',
    )
    if (!markPrice.ok) return markPrice
    const direction = ownDataValue(shape.object, 'direction')
    if (direction !== 'in' && direction !== 'out') {
      return {
        ok: false,
        issue: issue('invalid-transfer-direction', `${path}/direction`, direction, 'in or out'),
      }
    }
    return {
      ok: true,
      event: {
        kind: 'transfer',
        size: size.value,
        sizeDecimal: size.decimal,
        markPrice: markPrice.value,
        markPriceDecimal: markPrice.decimal,
        direction,
      },
    }
  }

  if (kind === 'genesis') {
    const shape = exactPlainObject(input, ['kind', 'size', 'maxSupply'], path)
    if (!shape.ok) return shape
    const size = decimal(ownDataValue(shape.object, 'size'), `${path}/size`, 'positive')
    if (!size.ok) return size
    const maxSupply = decimal(
      ownDataValue(shape.object, 'maxSupply'),
      `${path}/maxSupply`,
      'positive',
    )
    if (!maxSupply.ok) return maxSupply
    return {
      ok: true,
      event: {
        kind: 'genesis',
        size: size.value,
        sizeDecimal: size.decimal,
        maxSupply: maxSupply.value,
        maxSupplyDecimal: maxSupply.decimal,
      },
    }
  }

  if (kind === 'initialize-from-existing-balance') {
    const shape = exactPlainObject(input, ['kind', 'balance', 'eventPrice'], path)
    if (!shape.ok) return shape
    const balance = decimal(ownDataValue(shape.object, 'balance'), `${path}/balance`, 'positive')
    if (!balance.ok) return balance
    const eventPrice = decimal(
      ownDataValue(shape.object, 'eventPrice'),
      `${path}/eventPrice`,
      'positive',
    )
    if (!eventPrice.ok) return eventPrice
    return {
      ok: true,
      event: {
        kind: 'initialize-from-existing-balance',
        balance: balance.value,
        balanceDecimal: balance.decimal,
        eventPrice: eventPrice.value,
        eventPriceDecimal: eventPrice.decimal,
      },
    }
  }

  return {
    ok: false,
    issue: issue(
      'invalid-spot-event-kind',
      `${path}/kind`,
      kind,
      'buy, sell, transfer, genesis, or initialize-from-existing-balance',
    ),
  }
}

export function normalizeConvertSpotTokenUnitsInput(
  input: unknown,
):
  | { readonly ok: true; readonly value: NormalizedConvertSpotTokenUnitsInput }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['value', 'weiDecimals', 'direction'], '')
  if (!shape.ok) return shape
  const value = ownDataValue(shape.object, 'value')
  if (typeof value !== 'string') {
    return {
      ok: false,
      issue: issue('invalid-decimal-string', '/value', value, 'plain decimal string'),
    }
  }
  const weiDecimals = normalizeSafeIntegerRange(
    ownDataValue(shape.object, 'weiDecimals'),
    '/weiDecimals',
    0,
    255,
  )
  if (!weiDecimals.ok) return weiDecimals
  const direction = ownDataValue(shape.object, 'direction')
  if (direction !== 'human-to-minimal' && direction !== 'minimal-to-human') {
    return {
      ok: false,
      issue: issue(
        'invalid-spot-unit-direction',
        '/direction',
        direction,
        'human-to-minimal or minimal-to-human',
      ),
    }
  }
  return { ok: true, value: { value, weiDecimals: weiDecimals.value, direction } }
}

export function normalizeSpotOrderDeltasInput(
  input: unknown,
):
  | { readonly ok: true; readonly value: NormalizedSpotOrderDeltasInput }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['side', 'baseSize', 'price'], '')
  if (!shape.ok) return shape
  const side = ownDataValue(shape.object, 'side')
  if (side !== 'buy' && side !== 'sell') {
    return { ok: false, issue: issue('invalid-spot-side', '/side', side, 'buy or sell') }
  }
  const baseSize = decimal(ownDataValue(shape.object, 'baseSize'), '/baseSize', 'positive')
  if (!baseSize.ok) return baseSize
  const price = decimal(ownDataValue(shape.object, 'price'), '/price', 'positive')
  if (!price.ok) return price
  return {
    ok: true,
    value: {
      side,
      baseSize: baseSize.value,
      baseSizeDecimal: baseSize.decimal,
      price: price.value,
      priceDecimal: price.decimal,
    },
  }
}

export function normalizeProjectSpotPositionEventInput(
  input: unknown,
):
  | { readonly ok: true; readonly value: NormalizedProjectSpotPositionEventInput }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['position', 'event'], '')
  if (!shape.ok) return shape
  const position = normalizePosition(ownDataValue(shape.object, 'position'), '/position')
  if (!position.ok) return position
  const event = normalizeEvent(ownDataValue(shape.object, 'event'), '/event')
  if (!event.ok) return event
  return { ok: true, value: { position: position.position, event: event.event } }
}

function normalizePortfolioBalance(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly balance: NormalizedSpotPortfolioBalance }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['tokenKey', 'balance', 'entryPrice', 'markPrice'], path)
  if (!shape.ok) return shape
  const tokenKey = ownDataValue(shape.object, 'tokenKey')
  if (typeof tokenKey !== 'string' || tokenKey.length === 0) {
    return {
      ok: false,
      issue: issue('invalid-token-key', `${path}/tokenKey`, tokenKey, 'non-empty string'),
    }
  }
  const balance = decimal(ownDataValue(shape.object, 'balance'), `${path}/balance`, 'non-negative')
  if (!balance.ok) return balance
  const entryPrice = decimal(
    ownDataValue(shape.object, 'entryPrice'),
    `${path}/entryPrice`,
    'positive',
  )
  if (!entryPrice.ok) return entryPrice
  const markPrice = decimal(
    ownDataValue(shape.object, 'markPrice'),
    `${path}/markPrice`,
    'positive',
  )
  if (!markPrice.ok) return markPrice
  return {
    ok: true,
    balance: {
      tokenKey,
      balance: balance.value,
      balanceDecimal: balance.decimal,
      entryPrice: entryPrice.value,
      entryPriceDecimal: entryPrice.decimal,
      markPrice: markPrice.value,
      markPriceDecimal: markPrice.decimal,
    },
  }
}

export function normalizeCalculateSpotPortfolioValueInput(
  input: unknown,
):
  | { readonly ok: true; readonly value: NormalizedCalculateSpotPortfolioValueInput }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['balances'], '')
  if (!shape.ok) return shape
  const array = exactPlainArray(ownDataValue(shape.object, 'balances'), '/balances', {
    maxLength: 1024,
  })
  if (!array.ok) return array

  const seen = new Set<string>()
  const balances: NormalizedSpotPortfolioBalance[] = []
  for (let index = 0; index < array.values.length; index += 1) {
    const balance = normalizePortfolioBalance(array.values[index], `/balances/${index}`)
    if (!balance.ok) return balance
    if (seen.has(balance.balance.tokenKey)) {
      return {
        ok: false,
        issue: issue(
          'duplicate-token-key',
          `/balances/${index}/tokenKey`,
          balance.balance.tokenKey,
          'unique tokenKey',
        ),
      }
    }
    seen.add(balance.balance.tokenKey)
    balances.push(balance.balance)
  }
  return { ok: true, value: { balances } }
}

export function normalizeEvaluateSpotDustEligibilityInput(
  input: unknown,
):
  | { readonly ok: true; readonly value: NormalizedEvaluateSpotDustEligibilityInput }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(
    input,
    ['balance', 'midPrice', 'weiDecimals', 'szDecimals', 'usdThreshold'],
    '',
  )
  if (!shape.ok) return shape
  const balance = decimal(ownDataValue(shape.object, 'balance'), '/balance', 'non-negative')
  if (!balance.ok) return balance
  const midPrice = decimal(ownDataValue(shape.object, 'midPrice'), '/midPrice', 'positive')
  if (!midPrice.ok) return midPrice
  const weiDecimals = normalizeSafeIntegerRange(
    ownDataValue(shape.object, 'weiDecimals'),
    '/weiDecimals',
    0,
    255,
  )
  if (!weiDecimals.ok) return weiDecimals
  const szDecimals = normalizeSafeIntegerRange(
    ownDataValue(shape.object, 'szDecimals'),
    '/szDecimals',
    0,
    255,
  )
  if (!szDecimals.ok) return szDecimals
  if (szDecimals.value > weiDecimals.value) {
    return {
      ok: false,
      issue: issue(
        'spot-token-decimal-constraint',
        '/szDecimals',
        szDecimals.value,
        'szDecimals <= weiDecimals',
      ),
    }
  }
  const usdThreshold = decimal(
    ownDataValue(shape.object, 'usdThreshold'),
    '/usdThreshold',
    'non-negative',
  )
  if (!usdThreshold.ok) return usdThreshold
  return {
    ok: true,
    value: {
      balance: balance.value,
      balanceDecimal: balance.decimal,
      midPrice: midPrice.value,
      midPriceDecimal: midPrice.decimal,
      weiDecimals: weiDecimals.value,
      szDecimals: szDecimals.value,
      usdThreshold: usdThreshold.value,
      usdThresholdDecimal: usdThreshold.decimal,
    },
  }
}

export function normalizeProjectSpotDustAllocationInput(
  input: unknown,
):
  | { readonly ok: true; readonly value: NormalizedProjectSpotDustAllocationInput }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(
    input,
    ['aggregateDustSize', 'executedProceeds', 'userDustSize', 'aggregateLotSize'],
    '',
  )
  if (!shape.ok) return shape
  const aggregateDustSize = decimal(
    ownDataValue(shape.object, 'aggregateDustSize'),
    '/aggregateDustSize',
    'non-negative',
  )
  if (!aggregateDustSize.ok) return aggregateDustSize
  const executedProceeds = decimal(
    ownDataValue(shape.object, 'executedProceeds'),
    '/executedProceeds',
    'non-negative',
  )
  if (!executedProceeds.ok) return executedProceeds
  const userDustSize = decimal(
    ownDataValue(shape.object, 'userDustSize'),
    '/userDustSize',
    'non-negative',
  )
  if (!userDustSize.ok) return userDustSize
  const aggregateLotSize = decimal(
    ownDataValue(shape.object, 'aggregateLotSize'),
    '/aggregateLotSize',
    'positive',
  )
  if (!aggregateLotSize.ok) return aggregateLotSize
  if (userDustSize.decimal.gt(aggregateDustSize.decimal)) {
    return {
      ok: false,
      issue: issue(
        'user-dust-exceeds-aggregate',
        '/userDustSize',
        userDustSize.value,
        'less than or equal to aggregateDustSize',
      ),
    }
  }
  if (
    aggregateDustSize.decimal.lt(aggregateLotSize.decimal) &&
    !executedProceeds.decimal.isZero()
  ) {
    return {
      ok: false,
      issue: issue(
        'burn-mode-proceeds-nonzero',
        '/executedProceeds',
        executedProceeds.value,
        '0 when aggregateDustSize < aggregateLotSize',
      ),
    }
  }
  return {
    ok: true,
    value: {
      aggregateDustSize: aggregateDustSize.value,
      aggregateDustSizeDecimal: aggregateDustSize.decimal,
      executedProceeds: executedProceeds.value,
      executedProceedsDecimal: executedProceeds.decimal,
      userDustSize: userDustSize.value,
      userDustSizeDecimal: userDustSize.decimal,
      aggregateLotSize: aggregateLotSize.value,
      aggregateLotSizeDecimal: aggregateLotSize.decimal,
    },
  }
}

export function decimalFromString(value: string) {
  return new Decimal40(value)
}
