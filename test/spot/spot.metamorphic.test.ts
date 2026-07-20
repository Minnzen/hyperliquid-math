import { Decimal } from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { expectInvalid, expectOk, spotFunction } from './helpers.js'

describe('spot directed mutation-kill vectors', () => {
  it('kills a minimal-unit rounding mutant by rejecting fractional human-to-minimal conversion', async () => {
    const convert = await spotFunction('convertSpotTokenUnits')

    const result = convert({
      value: '1.000000000000000001',
      weiDecimals: 17,
      direction: 'human-to-minimal',
    })

    expectInvalid(result, { code: 'fractional-minimal-units', path: '/value' })
  })

  it('kills an order-delta sign inversion mutant', async () => {
    const calculate = await spotFunction('calculateSpotOrderDeltas')

    const result = calculate({ side: 'sell', baseSize: '3', price: '7.5' })

    expectOk<{ notional: string; baseDelta: string; quoteDelta: string }>(result)
    expect(result.value.data.notional).toBe('22.5')
    expect(result.value.data.baseDelta).toBe('-3')
    expect(result.value.data.quoteDelta).toBe('22.5')
  })

  it('kills a fee-sign mutant for spot sells with a negative rebate', async () => {
    const project = await spotFunction('projectSpotPositionEvent')

    const result = project({
      position: { kind: 'open', balance: '4', entryPrice: '10' },
      event: { kind: 'sell', size: '1', price: '13', feeQuoteAmount: '-0.2' },
    })

    expectOk<{ feeAccountValueDelta: string; closedPnl: string }>(result)
    expect(result.value.data).toMatchObject({
      grossRealizedPnl: '3',
      feeAmount: '-0.2',
      feeAccountValueDelta: '0.2',
      closedPnl: '3.2',
    })
  })

  it('kills a transfer-out-as-transfer-in mutant by realizing pnl and decreasing balance', async () => {
    const project = await spotFunction('projectSpotPositionEvent')

    const result = project({
      position: { kind: 'open', balance: '5', entryPrice: '2' },
      event: { kind: 'transfer', direction: 'out', size: '2', markPrice: '1.5' },
    })

    expectOk<{ nextState: unknown; closedPnl: string }>(result)
    expect(result.value.data).toMatchObject({
      classification: 'transfer-out',
      nextState: { kind: 'open', balance: '3', entryPrice: '2' },
      grossRealizedPnl: '-1',
      closedPnl: '-1',
      closedSize: '2',
      openedSize: '0',
    })
  })

  it('kills an average-entry overwrite mutant when increasing an existing spot position', async () => {
    const project = await spotFunction('projectSpotPositionEvent')

    const result = project({
      position: { kind: 'open', balance: '9', entryPrice: '1' },
      event: { kind: 'buy', size: '1', price: '11', feeQuoteAmount: '0' },
    })

    expectOk<{ nextState: { kind: string; balance: string; entryPrice: string } }>(result)
    expect(result.value.data.nextState).toEqual({ kind: 'open', balance: '10', entryPrice: '2' })
  })

  it('kills a duplicate-token aggregation mutant', async () => {
    const calculate = await spotFunction('calculateSpotPortfolioValue')

    const result = calculate({
      balances: [
        { tokenKey: 'DUP', balance: '1', entryPrice: '1', markPrice: '2' },
        { tokenKey: 'UNIQUE', balance: '1', entryPrice: '1', markPrice: '2' },
        { tokenKey: 'DUP', balance: '1', entryPrice: '1', markPrice: '2' },
      ],
    })

    expectInvalid(result, { code: 'duplicate-token-key', path: '/balances/2/tokenKey' })
  })

  it('kills a dust threshold strictness mutant by allowing equality on USD notional only', async () => {
    const evaluate = await spotFunction('evaluateSpotDustEligibility')

    const eligible = evaluate({
      balance: '0.009',
      midPrice: '100',
      weiDecimals: 8,
      szDecimals: 2,
      usdThreshold: '0.9',
    })
    const ineligible = evaluate({
      balance: '0.009',
      midPrice: '100',
      weiDecimals: 8,
      szDecimals: 2,
      usdThreshold: '0.899999',
    })

    expectOk<{ eligible: boolean }>(eligible)
    expectOk<{ eligible: boolean }>(ineligible)
    expect(eligible.value.data.eligible).toBe(true)
    expect(ineligible.value.data.eligible).toBe(false)
  })

  it('kills a dust allocation burn-threshold mutant at the exact aggregate lot boundary', async () => {
    const project = await spotFunction('projectSpotDustAllocation')

    const result = project({
      aggregateDustSize: '1',
      executedProceeds: '5',
      userDustSize: '0.2',
      aggregateLotSize: '1',
    })

    expectOk<{ mode: string; allocationRatio: string; userProceeds: string }>(result)
    expect(result.value.data).toEqual({
      mode: 'converted',
      allocationRatio: '0.2',
      userProceeds: '1',
    })
  })

  it('keeps portfolio unrealized pnl invariant when entry and mark prices shift equally', async () => {
    const calculate = await spotFunction('calculateSpotPortfolioValue')
    const base = calculate({
      balances: [{ tokenKey: 'SHIFT', balance: '3', entryPrice: '10', markPrice: '12' }],
    })
    const shifted = calculate({
      balances: [{ tokenKey: 'SHIFT', balance: '3', entryPrice: '110', markPrice: '112' }],
    })

    expectOk<{ unrealizedPnl: string }>(base)
    expectOk<{ unrealizedPnl: string }>(shifted)
    expect(base.value.data.unrealizedPnl).toBe('6')
    expect(shifted.value.data.unrealizedPnl).toBe('6')
  })

  it('keeps converted dust proceeds linear in user dust size', async () => {
    const project = await spotFunction('projectSpotDustAllocation')

    const small = project({
      aggregateDustSize: '10',
      executedProceeds: '25',
      userDustSize: '2',
      aggregateLotSize: '1',
    })
    const large = project({
      aggregateDustSize: '10',
      executedProceeds: '25',
      userDustSize: '4',
      aggregateLotSize: '1',
    })

    expectOk<{ userProceeds: string }>(small)
    expectOk<{ userProceeds: string }>(large)
    expect(
      new Decimal(large.value.data.userProceeds).div(small.value.data.userProceeds).toFixed(),
    ).toBe('2')
  })
})
