import { describe, expect, it } from 'vitest'
import {
  calculatePerpInitialMargin,
  calculatePerpMaintenanceMargin,
  evaluatePerpAccountMargin,
} from '../../../src/margin/index.js'

const btc = { network: 'mainnet', marketKind: 'perp', dex: null, index: 0 } as const
const eth = { network: 'mainnet', marketKind: 'perp', dex: null, index: 1 } as const

const singleTier = [{ lowerBound: '0', maxLeverage: '10' }] as const
const steppedTiers = [
  { lowerBound: '0', maxLeverage: '10' },
  { lowerBound: '1000', maxLeverage: '5' },
] as const
const highLeverageTier = [{ lowerBound: '0', maxLeverage: '40' }] as const

describe('calculatePerpInitialMargin', () => {
  it('returns not-applicable for zero exposure without inventing margin', () => {
    const result = calculatePerpInitialMargin({
      position: {
        asset: btc,
        signedSize: '0',
        markPrice: '100',
        leverage: '5',
        marginMode: { kind: 'cross' },
        marginTiers: singleTier,
      },
    })

    expect(result.value).toEqual({
      status: 'not-applicable',
      reason: { code: 'zero-position-size', path: '/position/signedSize' },
    })
  })

  it('reports when opening leverage exceeds the tier selected by position notional', () => {
    const result = calculatePerpInitialMargin({
      position: {
        asset: btc,
        signedSize: '1',
        markPrice: '10000',
        leverage: '10',
        marginMode: { kind: 'cross' },
        marginTiers: [
          { lowerBound: '0', maxLeverage: '10' },
          { lowerBound: '5000', maxLeverage: '5' },
        ],
      },
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        positionValue: '10000',
        initialMargin: '1000',
        tierIndex: 1,
        maxLeverage: '5',
        leverageCheck: {
          status: 'violated',
          ruleId: 'hl.margin.initial.leverage-within-tier',
          violation: {
            ruleId: 'hl.margin.initial.leverage-within-tier',
            code: 'leverage-exceeds-tier-max-leverage',
            path: '/position/leverage',
            actual: '10',
            limit: '5',
          },
        },
      },
    })
  })

  it('uses user leverage instead of asset max leverage', () => {
    const result = calculatePerpInitialMargin({
      position: {
        asset: btc,
        signedSize: '2',
        markPrice: '100',
        leverage: '5',
        marginMode: { kind: 'cross' },
        marginTiers: highLeverageTier,
      },
    })

    expect(result).toMatchObject({
      value: {
        status: 'ok',
        data: {
          positionValue: '200',
          initialMargin: '40',
          transferMarginRequirement: '40',
        },
      },
      trace: {
        formulaId: 'hl.margin.initial.calculate',
        completion: { status: 'complete' },
      },
    })
  })

  it('floors transfer margin at ten percent of position value', () => {
    const result = calculatePerpInitialMargin({
      position: {
        asset: btc,
        signedSize: '-3',
        markPrice: '200',
        leverage: '20',
        marginMode: { kind: 'cross' },
        marginTiers: highLeverageTier,
      },
    })

    expect(result.value).toEqual({
      status: 'ok',
      data: {
        positionValue: '600',
        initialMargin: '30',
        transferMarginRequirement: '60',
        tierIndex: 0,
        maxLeverage: '40',
        leverageCheck: {
          status: 'satisfied',
          ruleId: 'hl.margin.initial.leverage-within-tier',
        },
      },
    })
  })

  it('rejects leverage outside the protocol integer range', () => {
    const result = calculatePerpInitialMargin({
      position: {
        asset: btc,
        signedSize: '1',
        markPrice: '100',
        leverage: '0',
        marginMode: { kind: 'cross' },
        marginTiers: singleTier,
      },
    })

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-leverage',
          path: '/position/leverage',
        }),
      ]),
    )
  })
})

describe('calculatePerpMaintenanceMargin', () => {
  it('returns not-applicable for zero exposure without selecting a risk tier', () => {
    const result = calculatePerpMaintenanceMargin({
      position: {
        asset: btc,
        signedSize: '0',
        markPrice: '100',
        leverage: '5',
        marginMode: { kind: 'cross' },
        marginTiers: singleTier,
      },
    })

    expect(result.value).toEqual({
      status: 'not-applicable',
      reason: { code: 'zero-position-size', path: '/position/signedSize' },
    })
  })

  it('selects maintenance rate from max leverage and computes the backstop threshold', () => {
    const result = calculatePerpMaintenanceMargin({
      position: {
        asset: btc,
        signedSize: '4',
        markPrice: '100',
        leverage: '5',
        marginMode: { kind: 'cross' },
        marginTiers: singleTier,
      },
    })

    expect(result).toMatchObject({
      value: {
        status: 'ok',
        data: {
          positionValue: '400',
          tierIndex: 0,
          maintenanceRate: '0.05',
          maintenanceDeduction: '0',
          maintenanceMargin: '20',
          backstopThreshold: '13.33333333333333333333333333333333333333',
        },
      },
      trace: {
        formulaId: 'hl.margin.maintenance.calculate',
        completion: { status: 'complete' },
      },
    })
  })

  it('uses the higher tier at the exact notional boundary', () => {
    const result = calculatePerpMaintenanceMargin({
      position: {
        asset: btc,
        signedSize: '10',
        markPrice: '100',
        leverage: '5',
        marginMode: { kind: 'cross' },
        marginTiers: steppedTiers,
      },
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        positionValue: '1000',
        tierIndex: 1,
        tierLowerBound: '1000',
        nextTierLowerBound: null,
        maxLeverage: '5',
        maintenanceRate: '0.1',
        maintenanceDeduction: '50',
        maintenanceMargin: '50',
        backstopThreshold: '33.33333333333333333333333333333333333333',
      },
    })
  })

  it('keeps maintenance margin continuous across tier boundaries', () => {
    const below = calculatePerpMaintenanceMargin({
      position: {
        asset: btc,
        signedSize: '9.999',
        markPrice: '100',
        leverage: '5',
        marginMode: { kind: 'cross' },
        marginTiers: steppedTiers,
      },
    })
    const boundary = calculatePerpMaintenanceMargin({
      position: {
        asset: btc,
        signedSize: '10',
        markPrice: '100',
        leverage: '5',
        marginMode: { kind: 'cross' },
        marginTiers: steppedTiers,
      },
    })

    expect(below.value.status).toBe('ok')
    expect(boundary.value.status).toBe('ok')
    if (below.value.status !== 'ok' || boundary.value.status !== 'ok') return
    expect(below.value.data.maintenanceMargin).toBe('49.995')
    expect(boundary.value.data.maintenanceMargin).toBe('50')
  })
})

describe('evaluatePerpAccountMargin', () => {
  it('ignores zero-size rows when evaluating account totals', () => {
    const result = evaluatePerpAccountMargin({
      crossAccountValue: '1000',
      positions: [
        {
          asset: btc,
          signedSize: '0',
          markPrice: '100',
          leverage: '5',
          marginMode: { kind: 'cross' },
          marginTiers: singleTier,
        },
      ],
    })

    expect(result.value).toMatchObject({
      status: 'ok',
      data: {
        positions: [],
        cross: { positionValue: '0', initialMargin: '0', maintenanceMargin: '0' },
        totals: {
          totalPositionValue: '0',
          totalInitialMargin: '0',
          totalMaintenanceMargin: '0',
        },
      },
    })
  })

  it('excludes isolated positions from cross account margin', () => {
    const result = evaluatePerpAccountMargin({
      crossAccountValue: '1000',
      positions: [
        {
          asset: btc,
          signedSize: '2',
          markPrice: '100',
          leverage: '5',
          marginMode: { kind: 'cross' },
          marginTiers: singleTier,
        },
        {
          asset: eth,
          signedSize: '10',
          markPrice: '20',
          leverage: '5',
          marginMode: {
            kind: 'isolated',
            isolatedMarginValue: '80',
            marginRemoval: 'strict',
          },
          marginTiers: singleTier,
        },
      ],
    })

    expect(result).toMatchObject({
      value: {
        status: 'ok',
        data: {
          cross: {
            accountValue: '1000',
            positionValue: '200',
            initialMargin: '40',
            transferMarginRequirement: '40',
            maintenanceMargin: '10',
            backstopThreshold: '6.666666666666666666666666666666666666667',
            maintenanceMarginAvailable: '990',
            initialMarginAvailable: '960',
            transferMarginAvailable: '960',
            maxRemovableMargin: '960',
          },
        },
      },
      trace: {
        formulaId: 'hl.margin.account.evaluate',
        completion: { status: 'complete' },
      },
    })
  })

  it('calculates transfer margin from portfolio totals instead of per-position maxima', () => {
    const result = evaluatePerpAccountMargin({
      crossAccountValue: '1000',
      positions: [
        {
          asset: btc,
          signedSize: '1',
          markPrice: '100',
          leverage: '20',
          marginMode: { kind: 'cross' },
          marginTiers: highLeverageTier,
        },
        {
          asset: eth,
          signedSize: '-1',
          markPrice: '100',
          leverage: '20',
          marginMode: { kind: 'cross' },
          marginTiers: highLeverageTier,
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.cross.initialMargin).toBe('10')
    expect(result.value.data.cross.transferMarginRequirement).toBe('20')
    expect(result.value.data.positions).toHaveLength(2)
    expect(result.value.data.positions[0]).toMatchObject({
      asset: btc,
      marginMode: { kind: 'cross' },
      positionValue: '100',
      initialMargin: '5',
      transferMarginRequirement: '10',
    })
  })

  it('reports zero removable margin for strict isolated positions', () => {
    const result = evaluatePerpAccountMargin({
      crossAccountValue: '1000',
      positions: [
        {
          asset: btc,
          signedSize: '2',
          markPrice: '100',
          leverage: '5',
          marginMode: {
            kind: 'isolated',
            isolatedMarginValue: '80',
            marginRemoval: 'strict',
          },
          marginTiers: singleTier,
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.positions[0]).toMatchObject({
      asset: btc,
      marginMode: { kind: 'isolated', marginRemoval: 'strict' },
      positionValue: '200',
      initialMargin: '40',
      maintenanceMargin: '10',
      marginValue: '80',
      maxRemovableMargin: '0',
    })
    expect(result.value.data.cross.positionValue).toBe('0')
  })

  it('allows excess isolated transfer margin to be removed when configured', () => {
    const result = evaluatePerpAccountMargin({
      crossAccountValue: '1000',
      positions: [
        {
          asset: btc,
          signedSize: '2',
          markPrice: '100',
          leverage: '5',
          marginMode: {
            kind: 'isolated',
            isolatedMarginValue: '80',
            marginRemoval: 'allowed',
          },
          marginTiers: singleTier,
        },
      ],
    })

    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.positions[0]).toMatchObject({
      marginValue: '80',
      transferMarginRequirement: '40',
      transferMarginAvailable: '40',
      maxRemovableMargin: '40',
    })
  })
})
