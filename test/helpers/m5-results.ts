import {
  calculateHip3FeeRates,
  calculateSpotOrderDeltas,
  calculateSpotPortfolioValue,
  convertSpotTokenUnits,
  evaluateHip1AnchorGenesisEligibility,
  evaluateHip3MarginMode,
  evaluateSpotDustEligibility,
  projectSpotDustAllocation,
  projectSpotPositionEvent,
  resolveHip3CollateralSource,
  validateHip1Deployment,
} from '../../src/index.js'

function traceContract(result: {
  trace: { formulaId: string; authority: string; maturity: string; sourceRefs: readonly string[] }
}) {
  return {
    formulaId: result.trace.formulaId,
    authority: result.trace.authority,
    maturity: result.trace.maturity,
    sourceRefs: result.trace.sourceRefs,
  }
}

export function m5Results() {
  const spotUnits = convertSpotTokenUnits({
    value: '123.456',
    weiDecimals: 6,
    direction: 'human-to-minimal',
  })
  const spotOrderDeltas = calculateSpotOrderDeltas({
    side: 'buy',
    baseSize: '2.5',
    price: '4',
  })
  const spotPositionEvent = projectSpotPositionEvent({
    position: { kind: 'open', balance: '2', entryPrice: '10' },
    event: { kind: 'sell', size: '0.5', price: '12', feeQuoteAmount: '0.1' },
  })
  const spotPortfolioValue = calculateSpotPortfolioValue({
    balances: [
      {
        tokenKey: 'hl:mainnet:spot:PURR%2FUSDC:0',
        balance: '3',
        entryPrice: '2',
        markPrice: '2.5',
      },
      {
        tokenKey: 'hl:mainnet:spot:HFUN%2FUSDC:1',
        balance: '4',
        entryPrice: '1',
        markPrice: '0.75',
      },
    ],
  })
  const spotDustEligibility = evaluateSpotDustEligibility({
    balance: '0.00009',
    midPrice: '1000',
    weiDecimals: 8,
    szDecimals: 4,
    usdThreshold: '1',
  })
  const spotDustAllocation = projectSpotDustAllocation({
    aggregateDustSize: '10',
    executedProceeds: '25',
    userDustSize: '2',
    aggregateLotSize: '1',
  })
  const hip1Deployment = validateHip1Deployment({
    name: 'HYPE',
    weiDecimals: 8,
    szDecimals: 3,
    maxSupplyWei: '1000000000000',
    userGenesisWei: '600000000000',
    anchorGenesisWei: '400000000000',
  })
  const hip1AnchorGenesis = evaluateHip1AnchorGenesisEligibility({
    holderBalanceWei: '2',
    anchorTokenMaxSupplyWei: '1000001',
  })
  const hip3CollateralSource = resolveHip3CollateralSource({
    accountAbstractionMode: 'dex-abstraction-deprecated',
    dex: 'dex:blue',
    collateralTokenIndex: 7,
    validatorPerpUsdcTokenIndex: 0,
  })
  const hip3MarginMode = evaluateHip3MarginMode({
    assetMarginMode: 'strictIsolated',
    requestedMode: 'isolated',
  })
  const hip3FeeRates = calculateHip3FeeRates({
    makerRate: '-0.0001',
    takerRate: '0.0004',
    activeReferralDiscount: '0.04',
    isAlignedQuoteToken: true,
    deployerFeeScale: '0.5',
    growthMode: true,
  })
  const results = {
    spotUnits,
    spotOrderDeltas,
    spotPositionEvent,
    spotPortfolioValue,
    spotDustEligibility,
    spotDustAllocation,
    hip1Deployment,
    hip1AnchorGenesis,
    hip3CollateralSource,
    hip3MarginMode,
    hip3FeeRates,
  }

  return {
    values: Object.fromEntries(
      Object.entries(results).map(([name, result]) => [name, result.value]),
    ),
    traceContracts: Object.fromEntries(
      Object.entries(results).map(([name, result]) => [name, traceContract(result)]),
    ),
  }
}
