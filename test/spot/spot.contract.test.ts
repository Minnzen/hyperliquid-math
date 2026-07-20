import { describe, expect, it } from 'vitest'
import type { SpotApiName } from './helpers.js'
import { expectInvalid, spotFunction } from './helpers.js'

const spotFacades: ReadonlyArray<[SpotApiName, unknown]> = [
  ['convertSpotTokenUnits', { value: '1', weiDecimals: 6, direction: 'human-to-minimal' }],
  ['calculateSpotOrderDeltas', { side: 'buy', baseSize: '1', price: '1' }],
  [
    'projectSpotPositionEvent',
    {
      position: { kind: 'flat' },
      event: { kind: 'buy', size: '1', price: '1', feeQuoteAmount: '0' },
    },
  ],
  [
    'calculateSpotPortfolioValue',
    { balances: [{ tokenKey: 'ONE', balance: '1', entryPrice: '1', markPrice: '1' }] },
  ],
  [
    'evaluateSpotDustEligibility',
    { balance: '0.001', midPrice: '1', weiDecimals: 8, szDecimals: 2, usdThreshold: '1' },
  ],
  [
    'projectSpotDustAllocation',
    { aggregateDustSize: '1', executedProceeds: '1', userDustSize: '1', aggregateLotSize: '1' },
  ],
]

describe('M5 Spot public facade safety', () => {
  it.each(spotFacades)('%s rejects a non-object root as invalid input', async (name) => {
    const facade = await spotFunction(name)

    const result = facade(null)

    expectInvalid(result, { code: 'invalid-input-shape', path: '' })
  })

  it.each(spotFacades)('%s rejects a revoked root proxy without throwing', async (name) => {
    const facade = await spotFunction(name)
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()

    expect(() => facade(proxy)).not.toThrow()
    const result = facade(proxy)
    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion.status).toBe('incomplete')
  })

  it.each(spotFacades)('%s keeps invalid traces assumption-free', async (name) => {
    const facade = await spotFunction(name)

    const result = facade({ wrong: 'shape' })

    expect(result.value.status).toBe('invalid-input')
    expect(result.trace.completion.status).toBe('incomplete')
    expect(result.trace.assumptions).toEqual([])
    expect(result.trace.normalizedInputs).toEqual({})
  })

  it.each(spotFacades)(
    '%s records every normalized public input on success',
    async (name, input) => {
      const facade = await spotFunction(name)

      const result = facade(input)

      expect(result.value.status).toBe('ok')
      expect(result.trace.normalizedInputs).toEqual(input)
    },
  )

  it('rejects accessor-backed nested objects before trusting user data', async () => {
    const project = await spotFunction('projectSpotPositionEvent')
    const event = Object.defineProperty({ kind: 'buy', size: '1', price: '1' }, 'feeQuoteAmount', {
      enumerable: true,
      get() {
        return '0'
      },
    })

    const result = project({ position: { kind: 'flat' }, event })

    expectInvalid(result, { code: 'invalid-input-shape', path: '/event/feeQuoteAmount' })
  })

  it('rejects sparse portfolio balance arrays', async () => {
    const calculate = await spotFunction('calculateSpotPortfolioValue')
    const balances = new Array(1)

    const result = calculate({ balances })

    expectInvalid(result, { code: 'invalid-input-shape', path: '/balances' })
  })

  it('rejects aggregate portfolio balance arrays above the 1024-entry cap', async () => {
    const calculate = await spotFunction('calculateSpotPortfolioValue')
    const balances = Array.from({ length: 1025 }, (_, index) => ({
      tokenKey: `TOKEN-${index}`,
      balance: '0',
      entryPrice: '1',
      markPrice: '1',
    }))

    const result = calculate({ balances })

    expectInvalid(result, { code: 'invalid-input-shape', path: '/balances' })
  })

  it('records trace source references for caller-supplied mark, mid, and proceeds evidence', async () => {
    const projectEvent = await spotFunction('projectSpotPositionEvent')
    const evaluateDust = await spotFunction('evaluateSpotDustEligibility')
    const projectDust = await spotFunction('projectSpotDustAllocation')

    const transfer = projectEvent({
      position: { kind: 'flat' },
      event: { kind: 'transfer', direction: 'in', size: '1', markPrice: '1.23' },
    })
    const dust = evaluateDust({
      balance: '0.001',
      midPrice: '1.23',
      weiDecimals: 8,
      szDecimals: 2,
      usdThreshold: '1',
    })
    const allocation = projectDust({
      aggregateDustSize: '2',
      executedProceeds: '1.23',
      userDustSize: '1',
      aggregateLotSize: '1',
    })

    expect(transfer.trace.assumptions).toEqual(
      expect.arrayContaining([
        {
          kind: 'frozen-input',
          path: '/event/markPrice',
          value: 'caller-provided-unverified-mark',
        },
      ]),
    )
    expect(dust.trace.assumptions).toEqual(
      expect.arrayContaining([
        { kind: 'frozen-input', path: '/midPrice', value: 'caller-provided-unverified-mid' },
      ]),
    )
    expect(allocation.trace.assumptions).toEqual(
      expect.arrayContaining([
        {
          kind: 'frozen-input',
          path: '/executedProceeds',
          value: 'caller-provided-aggregate-sale-outcome',
        },
      ]),
    )
  })
})
