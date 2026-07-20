import { describe, expect, it } from 'vitest'
import type { NormalizedDecimalString } from '../../../src/core/decimal.js'
import { Decimal40 } from '../../../src/core/decimal.js'
import { calculatePerpLiquidationPrice } from '../../../src/liquidation/index.js'
import { computePerpLiquidationPriceNormalized } from '../../../src/liquidation/internal.js'
import type {
  NormalizedLiquidationInput,
  NormalizedLiquidationPosition,
} from '../../../src/liquidation/types.js'
import type { NormalizedPerpMarginTier } from '../../../src/margin/types.js'

const btc = {
  network: 'mainnet',
  marketKind: 'perp',
  dex: null,
  index: 0,
} as const

const eth = {
  network: 'mainnet',
  marketKind: 'perp',
  dex: null,
  index: 1,
} as const

const singleTier = [{ lowerBound: '0', maxLeverage: '10' }] as const

function validInput() {
  return {
    targetAsset: btc,
    crossAccountValue: '200',
    positions: [
      {
        asset: btc,
        signedSize: '10',
        entryPrice: '100',
        markPrice: '100',
        marginMode: { kind: 'cross' },
        marginTiers: singleTier,
      },
    ],
  }
}

function firstIssue(input: unknown) {
  const result = calculatePerpLiquidationPrice(input as never)
  expect(result.value.status).toBe('invalid-input')
  if (result.value.status !== 'invalid-input') throw new Error('expected invalid input')
  return result.value.issues[0]
}

function decimal(value: string | number) {
  return new Decimal40(value)
}

function normalized(value: string): NormalizedDecimalString {
  return value as NormalizedDecimalString
}

function tier(params: {
  lowerBound?: string
  maxLeverage?: string
  maintenanceRate: string
  maintenanceDeduction?: string
}): NormalizedPerpMarginTier {
  const lowerBound = params.lowerBound ?? '0'
  const maxLeverage = params.maxLeverage ?? '1'
  const maintenanceDeduction = params.maintenanceDeduction ?? '0'
  return {
    lowerBound: normalized(lowerBound),
    lowerBoundDecimal: decimal(lowerBound),
    maxLeverage: normalized(maxLeverage),
    maxLeverageDecimal: decimal(maxLeverage),
    maintenanceRate: params.maintenanceRate as NormalizedPerpMarginTier['maintenanceRate'],
    maintenanceRateDecimal: decimal(params.maintenanceRate),
    maintenanceDeduction: maintenanceDeduction as NormalizedPerpMarginTier['maintenanceDeduction'],
    maintenanceDeductionDecimal: decimal(maintenanceDeduction),
  }
}

function firstPosition(input: ReturnType<typeof validInput>) {
  const position = input.positions[0]
  if (position === undefined) throw new Error('valid input fixture must contain one position')
  return position
}

function normalizedPosition(
  overrides: Partial<NormalizedLiquidationPosition>,
): NormalizedLiquidationPosition {
  const signedSize = overrides.signedSize ?? '10'
  const markPrice = overrides.markPrice ?? '100'
  return {
    asset: btc,
    assetKey: 'hl:mainnet:perp::0',
    signedSize,
    signedSizeDecimal: decimal(signedSize),
    entryPrice: '100',
    markPrice,
    markPriceDecimal: decimal(markPrice),
    marginMode: {
      kind: 'isolated',
      isolatedMarginValue: '100',
      isolatedMarginValueDecimal: decimal('100'),
      marginRemoval: 'allowed',
    },
    marginTiers: [tier({ maintenanceRate: '0.05' })],
    ...overrides,
  }
}

function normalizedInput(
  target: NormalizedLiquidationPosition,
  overrides: Partial<NormalizedLiquidationInput> = {},
): NormalizedLiquidationInput {
  return {
    targetAsset: target.asset,
    targetAssetKey: target.assetKey,
    crossAccountValue: '0',
    crossAccountValueDecimal: decimal('0'),
    positions: [target],
    targetPositionIndex: 0,
    ...overrides,
  }
}

describe('liquidation coverage edges', () => {
  it('includes other cross positions in cross-account maintenance before solving the target root', () => {
    const withoutOtherCross = calculatePerpLiquidationPrice({
      targetAsset: btc,
      crossAccountValue: '300',
      positions: [
        {
          asset: btc,
          signedSize: '10',
          entryPrice: '100',
          markPrice: '100',
          marginMode: { kind: 'cross' },
          marginTiers: singleTier,
        },
      ],
    })
    const withOtherCross = calculatePerpLiquidationPrice({
      targetAsset: btc,
      crossAccountValue: '300',
      positions: [
        {
          asset: btc,
          signedSize: '10',
          entryPrice: '100',
          markPrice: '100',
          marginMode: { kind: 'cross' },
          marginTiers: singleTier,
        },
        {
          asset: eth,
          signedSize: '20',
          entryPrice: '10',
          markPrice: '10',
          marginMode: { kind: 'cross' },
          marginTiers: singleTier,
        },
      ],
    })

    expect(withoutOtherCross.value.status).toBe('ok')
    expect(withOtherCross.value.status).toBe('ok')
    if (withoutOtherCross.value.status !== 'ok' || withOtherCross.value.status !== 'ok') return
    expect(
      decimal(withOtherCross.value.data.totalAccountMaintenanceMargin).gt(
        withoutOtherCross.value.data.totalAccountMaintenanceMargin,
      ),
    ).toBe(true)
    expect(
      decimal(withOtherCross.value.data.liquidationPrice).gt(
        withoutOtherCross.value.data.liquidationPrice,
      ),
    ).toBe(true)
  })

  it('records a zero-denominator candidate when the normalized maintenance rate equals the long side size slope', () => {
    const result = computePerpLiquidationPriceNormalized(
      normalizedInput(
        normalizedPosition({
          marginTiers: [tier({ maxLeverage: '0.5', maintenanceRate: '1' })],
        }),
      ),
    )

    expect(result.root).toBeNull()
    expect(result.candidates).toEqual([
      {
        tierIndex: 0,
        price: null,
        notional: null,
        accepted: false,
        rejectedReason: 'zero-denominator',
      },
    ])
  })

  it('records a negative-maintenance candidate when a normalized tier deduction exceeds root notional maintenance', () => {
    const result = computePerpLiquidationPriceNormalized(
      normalizedInput(
        normalizedPosition({
          marginMode: {
            kind: 'isolated',
            isolatedMarginValue: '100',
            isolatedMarginValueDecimal: decimal('100'),
            marginRemoval: 'allowed',
          },
          marginTiers: [tier({ maintenanceRate: '0.1', maintenanceDeduction: '100' })],
        }),
      ),
    )

    expect(result.root).toBeNull()
    expect(result.candidates).toEqual([
      expect.objectContaining({
        tierIndex: 0,
        accepted: false,
        rejectedReason: 'negative-maintenance-at-root',
      }),
    ])
  })

  it('records null price and notional for a non-finite normalized root', () => {
    const result = computePerpLiquidationPriceNormalized(
      normalizedInput(
        normalizedPosition({
          marginMode: {
            kind: 'isolated',
            isolatedMarginValue: 'Infinity',
            isolatedMarginValueDecimal: decimal(Number.POSITIVE_INFINITY),
            marginRemoval: 'allowed',
          },
        }),
      ),
    )

    expect(result.root).toBeNull()
    expect(result.candidates).toEqual([
      {
        tierIndex: 0,
        price: null,
        notional: null,
        accepted: false,
        rejectedReason: 'non-positive-or-non-finite-root',
      },
    ])
  })

  it('rejects a liquidation margin mode with an isolated shape but unknown kind', () => {
    const result = calculatePerpLiquidationPrice({
      targetAsset: btc,
      crossAccountValue: '200',
      positions: [
        {
          asset: btc,
          signedSize: '10',
          entryPrice: '100',
          markPrice: '100',
          marginMode: {
            kind: 'portfolio',
            isolatedMarginValue: '200',
            marginRemoval: 'allowed',
          } as never,
          marginTiers: singleTier,
        },
      ],
    })

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-margin-mode',
        path: '/positions/0/marginMode/kind',
      }),
    ])
  })

  it('rejects an isolated liquidation margin mode with an unknown margin removal policy', () => {
    const result = calculatePerpLiquidationPrice({
      targetAsset: btc,
      crossAccountValue: '200',
      positions: [
        {
          asset: btc,
          signedSize: '10',
          entryPrice: '100',
          markPrice: '100',
          marginMode: {
            kind: 'isolated',
            isolatedMarginValue: '200',
            marginRemoval: 'deferred',
          } as never,
          marginTiers: singleTier,
        },
      ],
    })

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual([
      expect.objectContaining({
        code: 'invalid-margin-removal',
        path: '/positions/0/marginMode/marginRemoval',
      }),
    ])
  })

  it('rejects zero signed size before solving liquidation candidates', () => {
    const result = calculatePerpLiquidationPrice({
      targetAsset: btc,
      crossAccountValue: '200',
      positions: [
        {
          asset: btc,
          signedSize: '0',
          entryPrice: '100',
          markPrice: '100',
          marginMode: { kind: 'cross' },
          marginTiers: singleTier,
        },
      ],
    })

    expect(result.value.status).toBe('invalid-input')
    if (result.value.status !== 'invalid-input') return
    expect(result.value.issues).toEqual([
      expect.objectContaining({ code: 'zero-position-size', path: '/positions/0/signedSize' }),
    ])
  })

  it('rejects a non-object liquidation input root shape', () => {
    expect(firstIssue(null)).toEqual(expect.objectContaining({ code: 'invalid-input-shape' }))
  })

  it('rejects an invalid target asset before normalizing positions', () => {
    expect(firstIssue({ ...validInput(), targetAsset: { ...btc, network: 'devnet' } })).toEqual(
      expect.objectContaining({ code: 'invalid-network', path: '/targetAsset/network' }),
    )
  })

  it('rejects a non-plain cross account value before normalizing positions', () => {
    expect(firstIssue({ ...validInput(), crossAccountValue: '1e3' })).toEqual(
      expect.objectContaining({ code: 'invalid-decimal-string', path: '/crossAccountValue' }),
    )
  })

  it('rejects a non-array positions field before normalizing position rows', () => {
    expect(firstIssue({ ...validInput(), positions: null })).toEqual(
      expect.objectContaining({ code: 'invalid-input-shape', path: '/positions' }),
    )
  })

  it('rejects a position row with missing required liquidation fields', () => {
    const input = validInput()
    const { markPrice: _markPrice, ...positionWithoutMarkPrice } = firstPosition(input)

    expect(firstIssue({ ...input, positions: [positionWithoutMarkPrice] })).toEqual(
      expect.objectContaining({ code: 'invalid-input-shape', path: '/positions/0' }),
    )
  })

  it('rejects an invalid position asset before normalizing position decimals', () => {
    const input = validInput()

    expect(
      firstIssue({
        ...input,
        positions: [{ ...input.positions[0], asset: { ...btc, index: -1 } }],
      }),
    ).toEqual(expect.objectContaining({ code: 'invalid-index', path: '/positions/0/asset/index' }))
  })

  it('rejects a non-plain signed size before solving position size checks', () => {
    const input = validInput()

    expect(
      firstIssue({ ...input, positions: [{ ...input.positions[0], signedSize: '1e1' }] }),
    ).toEqual(
      expect.objectContaining({ code: 'invalid-decimal-string', path: '/positions/0/signedSize' }),
    )
  })

  it('rejects a non-positive entry price before normalizing mark price', () => {
    const input = validInput()

    expect(
      firstIssue({ ...input, positions: [{ ...input.positions[0], entryPrice: '0' }] }),
    ).toEqual(
      expect.objectContaining({
        code: 'non-positive-decimal',
        path: '/positions/0/entryPrice',
      }),
    )
  })

  it('rejects a non-positive mark price before normalizing margin mode', () => {
    const input = validInput()

    expect(
      firstIssue({ ...input, positions: [{ ...input.positions[0], markPrice: '0' }] }),
    ).toEqual(
      expect.objectContaining({ code: 'non-positive-decimal', path: '/positions/0/markPrice' }),
    )
  })

  it('rejects a non-object margin mode before normalizing margin tiers', () => {
    const input = validInput()

    expect(
      firstIssue({ ...input, positions: [{ ...input.positions[0], marginMode: null }] }),
    ).toEqual(
      expect.objectContaining({ code: 'invalid-input-shape', path: '/positions/0/marginMode' }),
    )
  })

  it('rejects a non-plain isolated margin value before checking margin removal policy', () => {
    const input = validInput()

    expect(
      firstIssue({
        ...input,
        positions: [
          {
            ...input.positions[0],
            marginMode: {
              kind: 'isolated',
              isolatedMarginValue: '1e2',
              marginRemoval: 'allowed',
            },
          },
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        code: 'invalid-decimal-string',
        path: '/positions/0/marginMode/isolatedMarginValue',
      }),
    )
  })

  it('rejects invalid liquidation margin tiers before accepting a normalized position', () => {
    const input = validInput()

    expect(
      firstIssue({ ...input, positions: [{ ...input.positions[0], marginTiers: [] }] }),
    ).toEqual(
      expect.objectContaining({ code: 'invalid-margin-tiers', path: '/positions/0/marginTiers' }),
    )
  })
})
