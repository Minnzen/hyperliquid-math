import { describe, expect, it } from 'vitest'
import {
  expectInvalid,
  expectNoRounding,
  expectOk,
  expectStableTrace,
  spotFunction,
} from './helpers.js'

describe('convertSpotTokenUnits', () => {
  it('converts human token units to minimal units without rounding', async () => {
    const convert = await spotFunction('convertSpotTokenUnits')

    const result = convert({
      value: '1.234567',
      weiDecimals: 6,
      direction: 'human-to-minimal',
    })

    expectOk<{ value: string }>(result)
    expect(result.value.data).toEqual({ value: '1234567' })
    expectStableTrace(result, {
      formulaId: 'hl.spot.units.convert',
      sourceId: 'HLM.SPEC.SPOT.UNITS_CONVERT.V1',
    })
    expectNoRounding(result)
  })

  it('converts minimal units to canonical human units', async () => {
    const convert = await spotFunction('convertSpotTokenUnits')

    const result = convert({
      value: '1234500',
      weiDecimals: 6,
      direction: 'minimal-to-human',
    })

    expectOk<{ value: string }>(result)
    expect(result.value.data).toEqual({ value: '1.2345' })
    expect(result.trace.normalizedInputs).toEqual({
      value: '1234500',
      weiDecimals: 6,
      direction: 'minimal-to-human',
    })
  })

  it('rejects fractional minimal units instead of rounding user balances', async () => {
    const convert = await spotFunction('convertSpotTokenUnits')

    const result = convert({
      value: '0.0000001',
      weiDecimals: 6,
      direction: 'human-to-minimal',
    })

    expectInvalid(result, { code: 'fractional-minimal-units', path: '/value' })
    expectNoRounding(result)
  })

  it('supports the defensive zero wei-decimal boundary', async () => {
    const convert = await spotFunction('convertSpotTokenUnits')

    const result = convert({ value: '42', weiDecimals: 0, direction: 'human-to-minimal' })

    expectOk<{ value: string }>(result)
    expect(result.value.data.value).toBe('42')
  })

  it('rejects a wei-decimal value outside the local defensive range', async () => {
    const convert = await spotFunction('convertSpotTokenUnits')

    const result = convert({ value: '1', weiDecimals: 256, direction: 'human-to-minimal' })

    expectInvalid(result, { code: 'invalid-safe-integer-range', path: '/weiDecimals' })
  })
})

describe('calculateSpotOrderDeltas', () => {
  it('returns signed balance deltas for a buy commitment', async () => {
    const calculate = await spotFunction('calculateSpotOrderDeltas')

    const result = calculate({ side: 'buy', baseSize: '2.5', price: '101.25' })

    expectOk<{ notional: string; baseDelta: string; quoteDelta: string }>(result)
    expect(result.value.data).toEqual({
      notional: '253.125',
      baseDelta: '2.5',
      quoteDelta: '-253.125',
    })
    expectStableTrace(result, {
      formulaId: 'hl.spot.order-deltas.calculate',
      sourceId: 'HLM.SPEC.SPOT.ORDER_DELTAS.V1',
    })
    expectNoRounding(result)
  })

  it('returns signed balance deltas for a sell commitment', async () => {
    const calculate = await spotFunction('calculateSpotOrderDeltas')

    const result = calculate({ side: 'sell', baseSize: '0.125', price: '80000.0001' })

    expectOk<{ notional: string; baseDelta: string; quoteDelta: string }>(result)
    expect(result.value.data).toEqual({
      notional: '10000.0000125',
      baseDelta: '-0.125',
      quoteDelta: '10000.0000125',
    })
    expectNoRounding(result)
  })

  it('rejects zero base size because order deltas require a positive size', async () => {
    const calculate = await spotFunction('calculateSpotOrderDeltas')

    const result = calculate({ side: 'buy', baseSize: '0', price: '100' })

    expectInvalid(result, { code: 'non-positive-decimal', path: '/baseSize' })
  })
})

describe('projectSpotPositionEvent', () => {
  it('opens from flat on buy and subtracts a positive quote fee from closed pnl', async () => {
    const project = await spotFunction('projectSpotPositionEvent')

    const result = project({
      position: { kind: 'flat' },
      event: { kind: 'buy', size: '2', price: '100', feeQuoteAmount: '0.5' },
    })

    expectOk<{
      classification: string
      grossRealizedPnl: string
      feeAmount: string
      feeAccountValueDelta: string
      closedPnl: string
      openedSize: string
      closedSize: string
      previousState: unknown
      nextState: unknown
    }>(result)
    expect(result.value.data).toMatchObject({
      classification: 'open',
      previousState: { kind: 'flat' },
      nextState: { kind: 'open', balance: '2', entryPrice: '100' },
      grossRealizedPnl: '0',
      feeAmount: '0.5',
      feeAccountValueDelta: '-0.5',
      closedPnl: '-0.5',
      openedSize: '2',
      closedSize: '0',
    })
    expectStableTrace(result, {
      formulaId: 'hl.spot.position-event.project',
      sourceId: 'HLM.SPEC.SPOT.POSITION_EVENT_PROJECT.V1',
    })
    expect(result.trace.assumptions).toEqual(
      expect.arrayContaining([
        { kind: 'frozen-input', path: '/event/feeQuoteAmount', value: 'signed-user-cost' },
      ]),
    )
  })

  it('increases inventory with a size-weighted entry price', async () => {
    const project = await spotFunction('projectSpotPositionEvent')

    const result = project({
      position: { kind: 'open', balance: '2', entryPrice: '100' },
      event: { kind: 'buy', size: '3', price: '110', feeQuoteAmount: '0' },
    })

    expectOk<{ nextState: unknown }>(result)
    expect(result.value.data).toMatchObject({
      classification: 'increase',
      nextState: { kind: 'open', balance: '5', entryPrice: '106' },
      openedSize: '3',
      closedSize: '0',
      closedPnl: '0',
    })
    expect(result.trace.rounding).toEqual([
      {
        path: '/value/data/nextState/entryPrice',
        input: '(2*100+3*110)/(2+3)',
        output: '106',
        mode: 'half-even',
        reasonCode: 'decimal40-division',
      },
    ])
  })

  it('partially sells inventory with unchanged entry and signed rebate convention', async () => {
    const project = await spotFunction('projectSpotPositionEvent')

    const result = project({
      position: { kind: 'open', balance: '5', entryPrice: '100' },
      event: { kind: 'sell', size: '2', price: '90', feeQuoteAmount: '-0.25' },
    })

    expectOk<{ nextState: unknown }>(result)
    expect(result.value.data).toMatchObject({
      classification: 'reduce',
      previousState: { kind: 'open', balance: '5', entryPrice: '100' },
      nextState: { kind: 'open', balance: '3', entryPrice: '100' },
      grossRealizedPnl: '-20',
      feeAmount: '-0.25',
      feeAccountValueDelta: '0.25',
      closedPnl: '-19.75',
      openedSize: '0',
      closedSize: '2',
    })
  })

  it('closes inventory exactly on a full sell', async () => {
    const project = await spotFunction('projectSpotPositionEvent')

    const result = project({
      position: { kind: 'open', balance: '2', entryPrice: '100' },
      event: { kind: 'sell', size: '2', price: '120', feeQuoteAmount: '1' },
    })

    expectOk<{ nextState: unknown }>(result)
    expect(result.value.data).toMatchObject({
      classification: 'close',
      nextState: { kind: 'flat' },
      grossRealizedPnl: '40',
      closedPnl: '39',
      closedSize: '2',
    })
  })

  it('rejects an oversell instead of flipping spot inventory negative', async () => {
    const project = await spotFunction('projectSpotPositionEvent')

    const result = project({
      position: { kind: 'open', balance: '1', entryPrice: '100' },
      event: { kind: 'sell', size: '1.0000001', price: '120', feeQuoteAmount: '0' },
    })

    expectInvalid(result, { code: 'spot-oversell', path: '/event/size' })
  })

  it('uses caller-supplied mark price for transfer-in entry accounting', async () => {
    const project = await spotFunction('projectSpotPositionEvent')

    const result = project({
      position: { kind: 'open', balance: '1', entryPrice: '100' },
      event: { kind: 'transfer', direction: 'in', size: '1', markPrice: '120' },
    })

    expectOk<{ nextState: unknown }>(result)
    expect(result.value.data).toMatchObject({
      classification: 'transfer-in',
      nextState: { kind: 'open', balance: '2', entryPrice: '110' },
      openedSize: '1',
      closedSize: '0',
    })
    expect(result.trace.assumptions).toEqual(
      expect.arrayContaining([
        {
          kind: 'frozen-input',
          path: '/event/markPrice',
          value: 'caller-provided-unverified-mark',
        },
      ]),
    )
  })

  it('uses caller-supplied mark price for transfer-out realized pnl accounting', async () => {
    const project = await spotFunction('projectSpotPositionEvent')

    const result = project({
      position: { kind: 'open', balance: '3', entryPrice: '50' },
      event: { kind: 'transfer', direction: 'out', size: '1', markPrice: '75' },
    })

    expectOk<{ nextState: unknown }>(result)
    expect(result.value.data).toMatchObject({
      classification: 'transfer-out',
      nextState: { kind: 'open', balance: '2', entryPrice: '50' },
      grossRealizedPnl: '25',
      closedPnl: '25',
      closedSize: '1',
    })
  })

  it('opens genesis inventory from the official ten-thousand-USDC market-cap basis', async () => {
    const project = await spotFunction('projectSpotPositionEvent')

    const result = project({
      position: { kind: 'flat' },
      event: { kind: 'genesis', size: '100', maxSupply: '2000000' },
    })

    expectOk<{ nextState: unknown }>(result)
    expect(result.value.data).toMatchObject({
      classification: 'genesis',
      nextState: { kind: 'open', balance: '100', entryPrice: '0.005' },
      openedSize: '100',
    })
    expect(result.trace).toMatchObject({
      authority: 'local-exact',
      maturity: 'experimental',
    })
    expect(result.trace.sourceRefs).toEqual(
      expect.arrayContaining([
        'HLM.SPEC.SPOT.POSITION_EVENT_PROJECT.V1',
        'HL.DOC.ENTRY_PNL.2026-07-19',
      ]),
    )
    expect(result.trace.rounding).toEqual([
      {
        path: '/value/data/nextState/entryPrice',
        input: '10000/2000000',
        output: '0.005',
        mode: 'half-even',
        reasonCode: 'decimal40-division',
      },
    ])
  })

  it('initializes a pre-existing balance at the first supplied event price', async () => {
    const project = await spotFunction('projectSpotPositionEvent')

    const result = project({
      position: { kind: 'flat' },
      event: {
        kind: 'initialize-from-existing-balance',
        balance: '7.5',
        eventPrice: '12.25',
      },
    })

    expectOk<{ nextState: unknown }>(result)
    expect(result.value.data).toMatchObject({
      classification: 'initialize-from-existing-balance',
      nextState: { kind: 'open', balance: '7.5', entryPrice: '12.25' },
      openedSize: '7.5',
      closedSize: '0',
    })
    expect(result.trace).toMatchObject({ maturity: 'experimental' })
    expect(result.trace.assumptions).toEqual(
      expect.arrayContaining([
        {
          kind: 'frozen-input',
          path: '/event/eventPrice',
          value: 'first-supplied-post-feature-event-price',
        },
      ]),
    )
  })

  it('rejects pre-existing balance initialization over an already-open state', async () => {
    const project = await spotFunction('projectSpotPositionEvent')

    const result = project({
      position: { kind: 'open', balance: '1', entryPrice: '10' },
      event: {
        kind: 'initialize-from-existing-balance',
        balance: '7.5',
        eventPrice: '12.25',
      },
    })

    expectInvalid(result, {
      code: 'spot-initialization-requires-flat',
      path: '/position/kind',
    })
  })
})

describe('calculateSpotPortfolioValue', () => {
  it('aggregates token value, entry notional, and unrealized pnl across dense balances', async () => {
    const calculate = await spotFunction('calculateSpotPortfolioValue')

    const result = calculate({
      balances: [
        { tokenKey: 'PURR', balance: '10', entryPrice: '0.1', markPrice: '0.25' },
        { tokenKey: 'HFUN', balance: '2.5', entryPrice: '4', markPrice: '3.5' },
        { tokenKey: 'ZERO', balance: '0', entryPrice: '1', markPrice: '99' },
      ],
    })

    expectOk<{
      portfolioValue: string
      entryNotional: string
      unrealizedPnl: string
      tokens: readonly unknown[]
    }>(result)
    expect(result.value.data).toEqual({
      tokens: [
        {
          tokenKey: 'PURR',
          balance: '10',
          entryPrice: '0.1',
          markPrice: '0.25',
          tokenValue: '2.5',
          entryNotional: '1',
          unrealizedPnl: '1.5',
        },
        {
          tokenKey: 'HFUN',
          balance: '2.5',
          entryPrice: '4',
          markPrice: '3.5',
          tokenValue: '8.75',
          entryNotional: '10',
          unrealizedPnl: '-1.25',
        },
        {
          tokenKey: 'ZERO',
          balance: '0',
          entryPrice: '1',
          markPrice: '99',
          tokenValue: '0',
          entryNotional: '0',
          unrealizedPnl: '0',
        },
      ],
      portfolioValue: '11.25',
      entryNotional: '11',
      unrealizedPnl: '0.25',
    })
    expectStableTrace(result, {
      formulaId: 'hl.spot.portfolio-value.calculate',
      sourceId: 'HLM.SPEC.SPOT.PORTFOLIO_VALUE.V1',
    })
  })

  it('rejects duplicate token keys because aggregation would be ambiguous', async () => {
    const calculate = await spotFunction('calculateSpotPortfolioValue')

    const result = calculate({
      balances: [
        { tokenKey: 'PURR', balance: '1', entryPrice: '1', markPrice: '1' },
        { tokenKey: 'PURR', balance: '2', entryPrice: '1', markPrice: '1' },
      ],
    })

    expectInvalid(result, { code: 'duplicate-token-key', path: '/balances/1/tokenKey' })
  })
})

describe('evaluateSpotDustEligibility', () => {
  it('marks balances below one lot and at the USD threshold as eligible', async () => {
    const evaluate = await spotFunction('evaluateSpotDustEligibility')

    const result = evaluate({
      balance: '0.009',
      midPrice: '100',
      weiDecimals: 8,
      szDecimals: 2,
      usdThreshold: '0.9',
    })

    expectOk<{
      lotSizeWei: string
      lotSize: string
      notionalUsd: string
      eligible: boolean
      checks: readonly unknown[]
    }>(result)
    expect(result.value.data).toEqual({
      lotSizeWei: '1000000',
      lotSize: '0.01',
      notionalUsd: '0.9',
      eligible: true,
      checks: [
        { status: 'satisfied', ruleId: 'hl.spot.dust.balance-below-lot' },
        { status: 'satisfied', ruleId: 'hl.spot.dust.notional-threshold' },
      ],
    })
    expectStableTrace(result, {
      formulaId: 'hl.spot.dust-eligibility.evaluate',
      sourceId: 'HLM.SPEC.SPOT.DUST_ELIGIBILITY.V1',
    })
    expect(result.trace.assumptions).toEqual(
      expect.arrayContaining([
        { kind: 'frozen-input', path: '/midPrice', value: 'caller-provided-unverified-mid' },
      ]),
    )
  })

  it('does not mark exactly one lot as dust', async () => {
    const evaluate = await spotFunction('evaluateSpotDustEligibility')

    const result = evaluate({
      balance: '0.01',
      midPrice: '100',
      weiDecimals: 8,
      szDecimals: 2,
      usdThreshold: '1',
    })

    expectOk<{ eligible: boolean; checks: readonly unknown[] }>(result)
    expect(result.value.data).toMatchObject({
      lotSize: '0.01',
      notionalUsd: '1',
      eligible: false,
      checks: expect.arrayContaining([
        expect.objectContaining({
          status: 'violated',
          ruleId: 'hl.spot.dust.balance-below-lot',
          violation: expect.objectContaining({
            ruleId: 'hl.spot.dust.balance-below-lot',
            actual: '0.01',
            limit: '0.01',
          }),
        }),
      ]),
    })
  })

  it('rejects token metadata whose lot cannot be an integer number of minimal units', async () => {
    const evaluate = await spotFunction('evaluateSpotDustEligibility')

    const result = evaluate({
      balance: '0.001',
      midPrice: '100',
      weiDecimals: 1,
      szDecimals: 2,
      usdThreshold: '1',
    })

    expectInvalid(result, { code: 'spot-token-decimal-constraint', path: '/szDecimals' })
  })
})

describe('projectSpotDustAllocation', () => {
  it('burns aggregate dust below one aggregate lot and allocates zero proceeds', async () => {
    const project = await spotFunction('projectSpotDustAllocation')

    const result = project({
      aggregateDustSize: '0.99',
      executedProceeds: '0',
      userDustSize: '0.5',
      aggregateLotSize: '1',
    })

    expectOk<{ mode: string; allocationRatio: string; userProceeds: string }>(result)
    expect(result.value.data).toEqual({
      mode: 'burn',
      allocationRatio: '0',
      userProceeds: '0',
    })
    expect(result.trace).toMatchObject({
      formulaId: 'hl.spot.dust-allocation.project',
      formulaVersion: 1,
      authority: 'local-exact',
      maturity: 'experimental',
      completion: { status: 'complete' },
    })
    expect(result.trace.sourceRefs).toEqual(
      expect.arrayContaining(['HLM.SPEC.SPOT.DUST_ALLOCATION_PROJECT.V1']),
    )
  })

  it('allocates converted proceeds by user share of aggregate dust', async () => {
    const project = await spotFunction('projectSpotDustAllocation')

    const result = project({
      aggregateDustSize: '10',
      executedProceeds: '3.75',
      userDustSize: '2.5',
      aggregateLotSize: '1',
    })

    expectOk<{ mode: string; allocationRatio: string; userProceeds: string }>(result)
    expect(result.value.data).toEqual({
      mode: 'converted',
      allocationRatio: '0.25',
      userProceeds: '0.9375',
    })
    expect(result.trace.assumptions).toEqual(
      expect.arrayContaining([
        {
          kind: 'frozen-input',
          path: '/executedProceeds',
          value: 'caller-provided-aggregate-sale-outcome',
        },
      ]),
    )
    expect(result.trace.rounding).toEqual([
      {
        path: '/value/data/allocationRatio',
        input: '2.5/10',
        output: '0.25',
        mode: 'half-even',
        reasonCode: 'decimal40-division',
      },
    ])
  })

  it('rejects a user dust size greater than aggregate dust size', async () => {
    const project = await spotFunction('projectSpotDustAllocation')

    const result = project({
      aggregateDustSize: '1',
      executedProceeds: '1',
      userDustSize: '1.0001',
      aggregateLotSize: '1',
    })

    expectInvalid(result, { code: 'user-dust-exceeds-aggregate', path: '/userDustSize' })
  })

  it('rejects non-zero proceeds in burn mode', async () => {
    const project = await spotFunction('projectSpotDustAllocation')

    const result = project({
      aggregateDustSize: '0.5',
      executedProceeds: '0.01',
      userDustSize: '0.1',
      aggregateLotSize: '1',
    })

    expectInvalid(result, { code: 'burn-mode-proceeds-nonzero', path: '/executedProceeds' })
  })

  it('rejects zero aggregate lot size because allocation mode needs a positive lot boundary', async () => {
    const project = await spotFunction('projectSpotDustAllocation')

    const result = project({
      aggregateDustSize: '0',
      executedProceeds: '0',
      userDustSize: '0',
      aggregateLotSize: '0',
    })

    expectInvalid(result, { code: 'non-positive-decimal', path: '/aggregateLotSize' })
  })
})
