import { describe, expect, it } from 'vitest'
import {
  calculateSpotOrderDeltas,
  calculateSpotPortfolioValue,
  convertSpotTokenUnits,
  evaluateSpotDustEligibility,
  projectSpotDustAllocation,
  projectSpotPositionEvent,
} from '../../src/spot/index.js'
import {
  convertInputs,
  dustAllocationInputs,
  dustEligibilityInputs,
  orderInputs,
  portfolioInputs,
} from '../../src/spot/trace.js'
import { decimalFromString } from '../../src/spot/validation.js'

function expectInvalid(
  result: { value: { status: string; issues?: readonly { code: string; path?: string }[] } },
  code: string,
  path: string,
) {
  expect(result.value.status).toBe('invalid-input')
  expect(result.value.issues).toEqual([expect.objectContaining({ code, path })])
}

describe('spot coverage hardening', () => {
  it.each([
    [
      'rejects a non-string unit value before conversion',
      () =>
        convertSpotTokenUnits({ value: 1, weiDecimals: 6, direction: 'human-to-minimal' } as never),
      'invalid-decimal-string',
      '/value',
    ],
    [
      'rejects an invalid unit conversion direction',
      () =>
        convertSpotTokenUnits({
          value: '1',
          weiDecimals: 6,
          direction: 'minimal-to-minimal',
        } as never),
      'invalid-spot-unit-direction',
      '/direction',
    ],
    [
      'rejects non-decimal human token input without rounding',
      () => convertSpotTokenUnits({ value: '1e-6', weiDecimals: 6, direction: 'human-to-minimal' }),
      'invalid-decimal-string',
      '/value',
    ],
    [
      'rejects negative human token input',
      () => convertSpotTokenUnits({ value: '-1', weiDecimals: 6, direction: 'human-to-minimal' }),
      'negative-decimal',
      '/value',
    ],
    [
      'rejects non-integer minimal token input',
      () => convertSpotTokenUnits({ value: '1.5', weiDecimals: 6, direction: 'minimal-to-human' }),
      'invalid-decimal-string',
      '/value',
    ],
    [
      'rejects negative minimal token input',
      () => convertSpotTokenUnits({ value: '-1', weiDecimals: 6, direction: 'minimal-to-human' }),
      'negative-decimal',
      '/value',
    ],
    [
      'rejects invalid spot order side',
      () => calculateSpotOrderDeltas({ side: 'hold', baseSize: '1', price: '1' } as never),
      'invalid-spot-side',
      '/side',
    ],
    [
      'rejects invalid spot order price after size validates',
      () => calculateSpotOrderDeltas({ side: 'buy', baseSize: '1', price: '0' }),
      'non-positive-decimal',
      '/price',
    ],
    [
      'rejects invalid open spot position kind',
      () =>
        projectSpotPositionEvent({
          position: { kind: 'closed', balance: '1', entryPrice: '1' } as never,
          event: { kind: 'buy', size: '1', price: '1', feeQuoteAmount: '0' },
        }),
      'invalid-position-kind',
      '/position/kind',
    ],
    [
      'rejects malformed open spot position shape',
      () =>
        projectSpotPositionEvent({
          position: { kind: 'open', balance: '1' } as never,
          event: { kind: 'buy', size: '1', price: '1', feeQuoteAmount: '0' },
        }),
      'invalid-input-shape',
      '/position',
    ],
    [
      'rejects non-positive open spot position balance',
      () =>
        projectSpotPositionEvent({
          position: { kind: 'open', balance: '0', entryPrice: '1' },
          event: { kind: 'buy', size: '1', price: '1', feeQuoteAmount: '0' },
        }),
      'non-positive-decimal',
      '/position/balance',
    ],
    [
      'rejects non-positive open spot position entry price',
      () =>
        projectSpotPositionEvent({
          position: { kind: 'open', balance: '1', entryPrice: '0' },
          event: { kind: 'buy', size: '1', price: '1', feeQuoteAmount: '0' },
        }),
      'non-positive-decimal',
      '/position/entryPrice',
    ],
    [
      'rejects a non-object spot event',
      () => projectSpotPositionEvent({ position: { kind: 'flat' }, event: null } as never),
      'invalid-input-shape',
      '/event',
    ],
    [
      'rejects an invalid spot event kind',
      () =>
        projectSpotPositionEvent({
          position: { kind: 'flat' },
          event: { kind: 'airdrop' },
        } as never),
      'invalid-spot-event-kind',
      '/event/kind',
    ],
    [
      'rejects a buy event with invalid size',
      () =>
        projectSpotPositionEvent({
          position: { kind: 'flat' },
          event: { kind: 'buy', size: '0', price: '1', feeQuoteAmount: '0' },
        }),
      'non-positive-decimal',
      '/event/size',
    ],
    [
      'rejects a buy event with invalid price',
      () =>
        projectSpotPositionEvent({
          position: { kind: 'flat' },
          event: { kind: 'buy', size: '1', price: '0', feeQuoteAmount: '0' },
        }),
      'non-positive-decimal',
      '/event/price',
    ],
    [
      'rejects a buy event with invalid signed quote fee',
      () =>
        projectSpotPositionEvent({
          position: { kind: 'flat' },
          event: { kind: 'buy', size: '1', price: '1', feeQuoteAmount: {} } as never,
        }),
      'invalid-decimal-string',
      '/event/feeQuoteAmount',
    ],
    [
      'rejects a transfer event with invalid shape',
      () =>
        projectSpotPositionEvent({
          position: { kind: 'flat' },
          event: { kind: 'transfer', size: '1', markPrice: '1' } as never,
        }),
      'invalid-input-shape',
      '/event',
    ],
    [
      'rejects a transfer event with invalid size',
      () =>
        projectSpotPositionEvent({
          position: { kind: 'flat' },
          event: { kind: 'transfer', direction: 'in', size: '0', markPrice: '1' },
        }),
      'non-positive-decimal',
      '/event/size',
    ],
    [
      'rejects a transfer event with invalid mark price',
      () =>
        projectSpotPositionEvent({
          position: { kind: 'flat' },
          event: { kind: 'transfer', direction: 'in', size: '1', markPrice: '0' },
        }),
      'non-positive-decimal',
      '/event/markPrice',
    ],
    [
      'rejects a transfer event with invalid direction',
      () =>
        projectSpotPositionEvent({
          position: { kind: 'flat' },
          event: { kind: 'transfer', direction: 'sideways', size: '1', markPrice: '1' } as never,
        }),
      'invalid-transfer-direction',
      '/event/direction',
    ],
    [
      'rejects a genesis event with invalid size',
      () =>
        projectSpotPositionEvent({
          position: { kind: 'flat' },
          event: { kind: 'genesis', size: '0', maxSupply: '1000' },
        }),
      'non-positive-decimal',
      '/event/size',
    ],
    [
      'rejects a genesis event with invalid max supply',
      () =>
        projectSpotPositionEvent({
          position: { kind: 'flat' },
          event: { kind: 'genesis', size: '1', maxSupply: '0' },
        }),
      'non-positive-decimal',
      '/event/maxSupply',
    ],
    [
      'rejects a malformed genesis event shape',
      () =>
        projectSpotPositionEvent({
          position: { kind: 'flat' },
          event: { kind: 'genesis', size: '1' } as never,
        }),
      'invalid-input-shape',
      '/event',
    ],
    [
      'rejects initialization with invalid balance',
      () =>
        projectSpotPositionEvent({
          position: { kind: 'flat' },
          event: { kind: 'initialize-from-existing-balance', balance: '0', eventPrice: '1' },
        }),
      'non-positive-decimal',
      '/event/balance',
    ],
    [
      'rejects initialization with invalid event price',
      () =>
        projectSpotPositionEvent({
          position: { kind: 'flat' },
          event: { kind: 'initialize-from-existing-balance', balance: '1', eventPrice: '0' },
        }),
      'non-positive-decimal',
      '/event/eventPrice',
    ],
    [
      'rejects a malformed initialization event shape',
      () =>
        projectSpotPositionEvent({
          position: { kind: 'flat' },
          event: { kind: 'initialize-from-existing-balance', balance: '1' } as never,
        }),
      'invalid-input-shape',
      '/event',
    ],
    [
      'rejects a portfolio row with empty token key',
      () =>
        calculateSpotPortfolioValue({
          balances: [{ tokenKey: '', balance: '1', entryPrice: '1', markPrice: '1' }],
        }),
      'invalid-token-key',
      '/balances/0/tokenKey',
    ],
    [
      'rejects a portfolio row with invalid balance',
      () =>
        calculateSpotPortfolioValue({
          balances: [{ tokenKey: 'BAD', balance: '-1', entryPrice: '1', markPrice: '1' }],
        }),
      'negative-decimal',
      '/balances/0/balance',
    ],
    [
      'rejects a malformed portfolio row shape',
      () =>
        calculateSpotPortfolioValue({
          balances: [{ tokenKey: 'BAD', balance: '1', entryPrice: '1' } as never],
        }),
      'invalid-input-shape',
      '/balances/0',
    ],
    [
      'rejects a portfolio row with invalid entry price',
      () =>
        calculateSpotPortfolioValue({
          balances: [{ tokenKey: 'BAD', balance: '1', entryPrice: '0', markPrice: '1' }],
        }),
      'non-positive-decimal',
      '/balances/0/entryPrice',
    ],
    [
      'rejects a portfolio row with invalid mark price',
      () =>
        calculateSpotPortfolioValue({
          balances: [{ tokenKey: 'BAD', balance: '1', entryPrice: '1', markPrice: '0' }],
        }),
      'non-positive-decimal',
      '/balances/0/markPrice',
    ],
    [
      'rejects dust eligibility with invalid balance',
      () =>
        evaluateSpotDustEligibility({
          balance: '-1',
          midPrice: '1',
          weiDecimals: 8,
          szDecimals: 4,
          usdThreshold: '1',
        }),
      'negative-decimal',
      '/balance',
    ],
    [
      'rejects dust eligibility with invalid mid price',
      () =>
        evaluateSpotDustEligibility({
          balance: '0',
          midPrice: '0',
          weiDecimals: 8,
          szDecimals: 4,
          usdThreshold: '1',
        }),
      'non-positive-decimal',
      '/midPrice',
    ],
    [
      'rejects dust eligibility with invalid wei decimals',
      () =>
        evaluateSpotDustEligibility({
          balance: '0',
          midPrice: '1',
          weiDecimals: 256,
          szDecimals: 4,
          usdThreshold: '1',
        }),
      'invalid-safe-integer-range',
      '/weiDecimals',
    ],
    [
      'rejects dust eligibility with invalid size decimals',
      () =>
        evaluateSpotDustEligibility({
          balance: '0',
          midPrice: '1',
          weiDecimals: 8,
          szDecimals: 256,
          usdThreshold: '1',
        }),
      'invalid-safe-integer-range',
      '/szDecimals',
    ],
    [
      'rejects dust eligibility with invalid USD threshold',
      () =>
        evaluateSpotDustEligibility({
          balance: '0',
          midPrice: '1',
          weiDecimals: 8,
          szDecimals: 4,
          usdThreshold: '-1',
        }),
      'negative-decimal',
      '/usdThreshold',
    ],
    [
      'rejects dust allocation with invalid aggregate size',
      () =>
        projectSpotDustAllocation({
          aggregateDustSize: '-1',
          executedProceeds: '0',
          userDustSize: '0',
          aggregateLotSize: '1',
        }),
      'negative-decimal',
      '/aggregateDustSize',
    ],
    [
      'rejects dust allocation with invalid executed proceeds',
      () =>
        projectSpotDustAllocation({
          aggregateDustSize: '1',
          executedProceeds: '-1',
          userDustSize: '0',
          aggregateLotSize: '1',
        }),
      'negative-decimal',
      '/executedProceeds',
    ],
    [
      'rejects dust allocation with invalid user dust size',
      () =>
        projectSpotDustAllocation({
          aggregateDustSize: '1',
          executedProceeds: '0',
          userDustSize: '-1',
          aggregateLotSize: '1',
        }),
      'negative-decimal',
      '/userDustSize',
    ],
  ] as const)('%s', (_name, act, code, path) => {
    expectInvalid(act(), code, path)
  })

  it('rejects transfer-out from flat as an oversell', () => {
    const result = projectSpotPositionEvent({
      position: { kind: 'flat' },
      event: { kind: 'transfer', direction: 'out', size: '1', markPrice: '1' },
    })

    expectInvalid(result, 'spot-oversell', '/event/size')
  })

  it('closes inventory exactly on a full transfer out', () => {
    const result = projectSpotPositionEvent({
      position: { kind: 'open', balance: '1', entryPrice: '2' },
      event: { kind: 'transfer', direction: 'out', size: '1', markPrice: '3' },
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        classification: 'transfer-out',
        nextState: { kind: 'flat' },
        grossRealizedPnl: '1',
        closedPnl: '1',
      },
    })
  })

  it('blends a genesis allocation into an existing open balance', () => {
    const result = projectSpotPositionEvent({
      position: { kind: 'open', balance: '2', entryPrice: '10' },
      event: { kind: 'genesis', size: '3', maxSupply: '1000' },
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        classification: 'genesis',
        nextState: { kind: 'open', balance: '5', entryPrice: '10' },
        openedSize: '3',
      },
    })
  })

  it('rejects uninspectable event objects before event normalization', () => {
    const event = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('uninspectable')
        },
      },
    )

    const result = projectSpotPositionEvent({
      position: { kind: 'flat' },
      event: event as never,
    })

    expectInvalid(result, 'invalid-input-shape', '/event')
  })

  it('normalizes zero-valued unit conversions without preserving leading zeros', () => {
    expect(
      convertSpotTokenUnits({ value: '000.000', weiDecimals: 3, direction: 'human-to-minimal' })
        .value,
    ).toEqual({
      status: 'ok',
      data: { value: '0' },
    })
    expect(
      convertSpotTokenUnits({ value: '0000', weiDecimals: 3, direction: 'minimal-to-human' }).value,
    ).toEqual({
      status: 'ok',
      data: { value: '0' },
    })
  })

  it('returns undefined-input trace helper payloads for incomplete traces', () => {
    expect(convertInputs(undefined)).toEqual({})
    expect(orderInputs(undefined)).toEqual({})
    expect(portfolioInputs(undefined)).toEqual({})
    expect(dustEligibilityInputs(undefined)).toEqual({})
    expect(dustAllocationInputs(undefined)).toEqual({})
  })

  it('exposes Decimal40 parsing through the validation helper', () => {
    expect(decimalFromString('1.2300').toFixed()).toBe('1.23')
  })
})
