import { Decimal } from 'decimal.js'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { decimalFromUnits, expectOk, spotFunction } from './helpers.js'

const unitSeed = 0x5_5001
const orderSeed = 0x5_5002
const portfolioSeed = 0x5_5003
const dustSeed = 0x5_5004
const allocationSeed = 0x5_5005

describe('spot properties', () => {
  it('round-trips non-negative integer minimal units through human units', async () => {
    const convert = await spotFunction('convertSpotTokenUnits')

    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 24n }),
        fc.integer({ min: 0, max: 18 }),
        (minimalUnits, weiDecimals) => {
          const minimal = minimalUnits.toString()
          const human = convert({ value: minimal, weiDecimals, direction: 'minimal-to-human' })
          expectOk<{ value: string }>(human)

          const roundTrip = convert({
            value: human.value.data.value,
            weiDecimals,
            direction: 'human-to-minimal',
          })
          expectOk<{ value: string }>(roundTrip)
          expect(roundTrip.value.data.value).toBe(minimal)
          expect(human.trace.rounding).toEqual([])
          expect(roundTrip.trace.rounding).toEqual([])
        },
      ),
      { numRuns: 300, seed: unitSeed },
    )
  })

  it('keeps buy and sell order deltas as exact signed opposites', async () => {
    const calculate = await spotFunction('calculateSpotOrderDeltas')

    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10_000_000_000n }),
        fc.bigInt({ min: 1n, max: 10_000_000_000n }),
        (baseUnits, priceCents) => {
          const baseSize = decimalFromUnits(baseUnits, 1_000_000n)
          const price = decimalFromUnits(priceCents, 100n)

          const buy = calculate({ side: 'buy', baseSize, price })
          const sell = calculate({ side: 'sell', baseSize, price })

          expectOk<{ notional: string; baseDelta: string; quoteDelta: string }>(buy)
          expectOk<{ notional: string; baseDelta: string; quoteDelta: string }>(sell)
          expect(buy.value.data.notional).toBe(sell.value.data.notional)
          expect(
            new Decimal(buy.value.data.baseDelta).plus(sell.value.data.baseDelta).toFixed(),
          ).toBe('0')
          expect(
            new Decimal(buy.value.data.quoteDelta).plus(sell.value.data.quoteDelta).toFixed(),
          ).toBe('0')
          expect(buy.value.data.notional).toBe(new Decimal(baseSize).times(price).toFixed())
        },
      ),
      { numRuns: 300, seed: orderSeed },
    )
  })

  it('aggregates portfolio totals as the exact sum of per-token rows', async () => {
    const calculate = await spotFunction('calculateSpotPortfolioValue')

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            balanceUnits: fc.bigInt({ min: 0n, max: 1_000_000n }),
            entryCents: fc.bigInt({ min: 1n, max: 1_000_000n }),
            markCents: fc.bigInt({ min: 1n, max: 1_000_000n }),
          }),
          { minLength: 0, maxLength: 16 },
        ),
        (rows) => {
          const balances = rows.map((row, index) => ({
            tokenKey: `TOKEN-${index}`,
            balance: decimalFromUnits(row.balanceUnits, 1_000n),
            entryPrice: decimalFromUnits(row.entryCents, 100n),
            markPrice: decimalFromUnits(row.markCents, 100n),
          }))

          const result = calculate({ balances })
          expectOk<{
            tokens: ReadonlyArray<{
              tokenValue: string
              entryNotional: string
              unrealizedPnl: string
            }>
            portfolioValue: string
            entryNotional: string
            unrealizedPnl: string
          }>(result)

          const portfolioValue = result.value.data.tokens
            .reduce((sum, row) => sum.plus(row.tokenValue), new Decimal(0))
            .toFixed()
          const entryNotional = result.value.data.tokens
            .reduce((sum, row) => sum.plus(row.entryNotional), new Decimal(0))
            .toFixed()
          const unrealizedPnl = result.value.data.tokens
            .reduce((sum, row) => sum.plus(row.unrealizedPnl), new Decimal(0))
            .toFixed()

          expect(result.value.data.portfolioValue).toBe(portfolioValue)
          expect(result.value.data.entryNotional).toBe(entryNotional)
          expect(result.value.data.unrealizedPnl).toBe(unrealizedPnl)
        },
      ),
      { numRuns: 200, seed: portfolioSeed },
    )
  })

  it('requires dust eligibility balance to be strictly below the lot size', async () => {
    const evaluate = await spotFunction('evaluateSpotDustEligibility')

    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 18 }),
        fc.integer({ min: 0, max: 8 }),
        fc.bigInt({ min: 1n, max: 10_000n }),
        (weiDecimals, szDecimals, priceCents) => {
          fc.pre(szDecimals + 5 <= weiDecimals)
          const lotSize = new Decimal(10).pow(-szDecimals).toFixed()
          const midPrice = decimalFromUnits(priceCents, 100n)
          const threshold = new Decimal(lotSize).times(midPrice).toFixed()

          const result = evaluate({
            balance: lotSize,
            midPrice,
            weiDecimals,
            szDecimals,
            usdThreshold: threshold,
          })

          expectOk<{ eligible: boolean; notionalUsd: string }>(result)
          expect(result.value.data.notionalUsd).toBe(threshold)
          expect(result.value.data.eligible).toBe(false)
        },
      ),
      { numRuns: 200, seed: dustSeed },
    )
  })

  it('never allocates more converted dust proceeds than the caller-supplied execution total', async () => {
    const project = await spotFunction('projectSpotDustAllocation')

    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000_000_000n }),
        fc.bigInt({ min: 0n, max: 1_000_000_000n }),
        fc.bigInt({ min: 0n, max: 1_000_000_000n }),
        (aggregateUnits, userUnits, proceedsCents) => {
          const boundedUserUnits = userUnits % (aggregateUnits + 1n)
          const aggregateDustSize = decimalFromUnits(aggregateUnits, 1_000n)
          const userDustSize = decimalFromUnits(boundedUserUnits, 1_000n)
          const executedProceeds = decimalFromUnits(proceedsCents, 100n)

          const result = project({
            aggregateDustSize,
            executedProceeds,
            userDustSize,
            aggregateLotSize: '0.001',
          })

          expectOk<{ mode: string; allocationRatio: string; userProceeds: string }>(result)
          expect(result.value.data.mode).toBe('converted')
          expect(new Decimal(result.value.data.userProceeds).lte(executedProceeds)).toBe(true)
          expect(new Decimal(result.value.data.allocationRatio).lte(1)).toBe(true)
        },
      ),
      { numRuns: 300, seed: allocationSeed },
    )
  })
})
