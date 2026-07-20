import type {
  calculateTradeFee,
  calculateWeightedFeeVolume,
  selectFeeTier,
} from 'hyperliquid-math/fees'
import type {
  annualizeFundingRate,
  calculateFundingPayment,
  calculateFundingPremiumIndex,
  calculateFundingRate,
} from 'hyperliquid-math/funding'
import type {
  evaluateHip1AnchorGenesisEligibility,
  validateHip1Deployment,
} from 'hyperliquid-math/hip1'
import type {
  calculateHip3FeeRates,
  evaluateHip3MarginMode,
  resolveHip3CollateralSource,
} from 'hyperliquid-math/hip3'
import type { AssetIdDecodeOutput } from 'hyperliquid-math/identifiers'
import type { MathResult } from 'hyperliquid-math/model'
import type { SimulatedBookFill } from 'hyperliquid-math/orderbook'
import type {
  buildPerpScaleLadder,
  calculatePerpMaxOrderSize,
  calculatePerpSlippagePrice,
  calculatePerpTwapSchedule,
  classifyPerpTrigger,
  derivePerpTriggerPrice,
  evaluatePerpReduceOnly,
  validatePerpOrder,
} from 'hyperliquid-math/orders'
import type {
  calculatePerpBreakEvenPrice,
  calculatePerpUnrealizedPnl,
  projectPerpFill,
  projectPerpFillSequence,
} from 'hyperliquid-math/positions'
import type { QuantizedDecimal } from 'hyperliquid-math/precision'
import type {
  reconcilePerpAccountSnapshot,
  replayPerpAccountEvents,
} from 'hyperliquid-math/reconciliation'
import type {
  calculateSpotOrderDeltas,
  calculateSpotPortfolioValue,
  convertSpotTokenUnits,
  evaluateSpotDustEligibility,
  projectSpotDustAllocation,
  projectSpotPositionEvent,
} from 'hyperliquid-math/spot'

declare const result: MathResult<string>
result satisfies MathResult<string>

declare const precisionResult: MathResult<QuantizedDecimal>
declare const assetResult: MathResult<AssetIdDecodeOutput>
declare const fillResult: MathResult<SimulatedBookFill>
declare const tradeFeeResult: ReturnType<typeof calculateTradeFee>
declare const weightedVolumeResult: ReturnType<typeof calculateWeightedFeeVolume>
declare const feeTierResult: ReturnType<typeof selectFeeTier>
declare const unrealizedPnlResult: ReturnType<typeof calculatePerpUnrealizedPnl>
declare const fillProjectResult: ReturnType<typeof projectPerpFill>
declare const fillSequenceResult: ReturnType<typeof projectPerpFillSequence>
declare const breakEvenResult: ReturnType<typeof calculatePerpBreakEvenPrice>
declare const fundingPremiumResult: ReturnType<typeof calculateFundingPremiumIndex>
declare const fundingRateResult: ReturnType<typeof calculateFundingRate>
declare const fundingPaymentResult: ReturnType<typeof calculateFundingPayment>
declare const annualizedFundingRateResult: ReturnType<typeof annualizeFundingRate>
declare const orderValidationResult: ReturnType<typeof validatePerpOrder>
declare const maxOrderSizeResult: ReturnType<typeof calculatePerpMaxOrderSize>
declare const reduceOnlyResult: ReturnType<typeof evaluatePerpReduceOnly>
declare const slippagePriceResult: ReturnType<typeof calculatePerpSlippagePrice>
declare const triggerClassificationResult: ReturnType<typeof classifyPerpTrigger>
declare const triggerPriceResult: ReturnType<typeof derivePerpTriggerPrice>
declare const scaleLadderResult: ReturnType<typeof buildPerpScaleLadder>
declare const twapScheduleResult: ReturnType<typeof calculatePerpTwapSchedule>
declare const replayResult: ReturnType<typeof replayPerpAccountEvents>
declare const reconciliationResult: ReturnType<typeof reconcilePerpAccountSnapshot>
declare const spotUnitsResult: ReturnType<typeof convertSpotTokenUnits>
declare const spotOrderDeltasResult: ReturnType<typeof calculateSpotOrderDeltas>
declare const spotPositionEventResult: ReturnType<typeof projectSpotPositionEvent>
declare const spotPortfolioValueResult: ReturnType<typeof calculateSpotPortfolioValue>
declare const spotDustEligibilityResult: ReturnType<typeof evaluateSpotDustEligibility>
declare const spotDustAllocationResult: ReturnType<typeof projectSpotDustAllocation>
declare const hip1DeploymentResult: ReturnType<typeof validateHip1Deployment>
declare const hip1AnchorGenesisResult: ReturnType<typeof evaluateHip1AnchorGenesisEligibility>
declare const hip3CollateralResult: ReturnType<typeof resolveHip3CollateralSource>
declare const hip3MarginModeResult: ReturnType<typeof evaluateHip3MarginMode>
declare const hip3FeeRatesResult: ReturnType<typeof calculateHip3FeeRates>
precisionResult satisfies MathResult<QuantizedDecimal>
assetResult satisfies MathResult<AssetIdDecodeOutput>
fillResult satisfies MathResult<SimulatedBookFill>
tradeFeeResult satisfies MathResult<unknown>
weightedVolumeResult satisfies MathResult<unknown>
feeTierResult satisfies MathResult<unknown>
unrealizedPnlResult satisfies MathResult<unknown>
fillProjectResult satisfies MathResult<unknown>
fillSequenceResult satisfies MathResult<unknown>
breakEvenResult satisfies MathResult<unknown>
fundingPremiumResult satisfies MathResult<unknown>
fundingRateResult satisfies MathResult<unknown>
fundingPaymentResult satisfies MathResult<unknown>
annualizedFundingRateResult satisfies MathResult<unknown>
orderValidationResult satisfies MathResult<unknown>
maxOrderSizeResult satisfies MathResult<unknown>
reduceOnlyResult satisfies MathResult<unknown>
slippagePriceResult satisfies MathResult<unknown>
triggerClassificationResult satisfies MathResult<unknown>
triggerPriceResult satisfies MathResult<unknown>
scaleLadderResult satisfies MathResult<unknown>
twapScheduleResult satisfies MathResult<unknown>
replayResult satisfies MathResult<unknown>
reconciliationResult satisfies MathResult<unknown>
spotUnitsResult satisfies MathResult<unknown>
spotOrderDeltasResult satisfies MathResult<unknown>
spotPositionEventResult satisfies MathResult<unknown>
spotPortfolioValueResult satisfies MathResult<unknown>
spotDustEligibilityResult satisfies MathResult<unknown>
spotDustAllocationResult satisfies MathResult<unknown>
hip1DeploymentResult satisfies MathResult<unknown>
hip1AnchorGenesisResult satisfies MathResult<unknown>
hip3CollateralResult satisfies MathResult<unknown>
hip3MarginModeResult satisfies MathResult<unknown>
hip3FeeRatesResult satisfies MathResult<unknown>
