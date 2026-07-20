import {
  annualizeFundingRate,
  calculateFundingPayment,
  calculateFundingPremiumIndex,
  calculateFundingRate,
  calculatePerpBreakEvenPrice,
  calculatePerpUnrealizedPnl,
  calculateTradeFee,
  calculateWeightedFeeVolume,
  projectPerpFill,
  projectPerpFillSequence,
  selectFeeTier,
} from '../../src/index.js'

export function m2Results() {
  return {
    tradeFee: calculateTradeFee({ price: '2500', size: '1', rate: '0.0002' }),
    weightedFeeVolume: calculateWeightedFeeVolume({
      perpsVolume: '1000000',
      spotVolume: '250000',
    }),
    feeTier: selectFeeTier({
      weightedVolume: '1500000',
      baseRates: { makerRate: '0.00015', takerRate: '0.00045' },
      tiers: [
        {
          minimumWeightedVolume: '1000000',
          makerRate: '0.00012',
          takerRate: '0.0004',
        },
      ],
    }),
    unrealizedPnl: calculatePerpUnrealizedPnl({
      position: { kind: 'open', signedSize: '3', entryPrice: '100' },
      markPrice: '110',
    }),
    fill: projectPerpFill({
      position: { kind: 'open', signedSize: '2', entryPrice: '100' },
      fill: {
        side: 'sell',
        size: '5',
        price: '110',
        fee: { kind: 'explicit', amount: '1' },
      },
    }),
    fillSequence: projectPerpFillSequence({
      position: { kind: 'flat' },
      fills: [
        { side: 'buy', size: '2', price: '100', fee: { kind: 'none' } },
        { side: 'buy', size: '3', price: '110', fee: { kind: 'none' } },
        { side: 'sell', size: '5', price: '106', fee: { kind: 'none' } },
      ],
    }),
    breakEven: calculatePerpBreakEvenPrice({
      position: { kind: 'open', signedSize: '2', entryPrice: '100' },
      cumulativeCost: '10',
    }),
    fundingPremium: calculateFundingPremiumIndex({
      impactBidPrice: '102',
      impactAskPrice: '99',
      oraclePrice: '100',
    }),
    fundingRate: calculateFundingRate({
      averagePremiumIndex: '0.01',
      rules: {
        interestRate: '0.0001',
        clampLower: '-0.0005',
        clampUpper: '0.0005',
        baseIntervalHours: 8,
        hourlyCap: '0.04',
      },
    }),
    fundingPayment: calculateFundingPayment({
      signedPositionSize: '10',
      oraclePrice: '10000',
      fundingRate: '0.0011875',
    }),
    annualizedFunding: annualizeFundingRate({
      periodicRate: '0.0000125',
      periodsPerYear: 8760,
      convention: 'simple',
    }),
  }
}
