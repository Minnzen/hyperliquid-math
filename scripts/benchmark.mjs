import { readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { normalizeDecimalString } from '../dist/core/decimal.js'
import {
  calculateBookMetrics,
  calculateFundingRate,
  calculateHip3FeeRates,
  calculateSpotPortfolioValue,
  canonicalizeDecimalString,
  projectPerpFill,
  projectPerpFillSequence,
  projectSpotPositionEvent,
  simulateBookFill,
  validateHip1Deployment,
} from '../dist/index.js'

const baselinePath = 'benchmarks/m0-baseline.json'
const m1BaselinePath = 'benchmarks/m1-baseline.json'
const m2BaselinePath = 'benchmarks/m2-baseline.json'
const m5BaselinePath = 'benchmarks/m5-baseline.json'
const limits = {
  schemaVersion: 1,
  case: 'canonicalize-decimal-valid',
  iterationsPerBatch: 20_000,
  warmupBatches: 20,
  measuredBatches: 50,
  maxFacadeToKernelRatio: 35,
  maxSerializedBytes: 640,
}

const m1Limits = {
  schemaVersion: 1,
  case: 'm1-orderbook-bounded-trace',
  maxMetricsTraceBytes: 1_600,
  maxFillTraceBytes: 2_000,
  maxFillTraceGrowthBytes: 128,
  maxTwentyLevelFillResultBytes: 8_192,
}

const m2Limits = {
  schemaVersion: 1,
  case: 'm2-position-funding-bounded-trace',
  maxFillProjectionTraceBytes: 1_600,
  maxFundingRateTraceBytes: 1_600,
  maxSequenceTraceBytes: 1_600,
  maxSequenceTraceGrowthBytes: 256,
  maxTwoThousandFillResultBytes: 786_432,
}

const m5Limits = {
  schemaVersion: 1,
  case: 'm5-spot-hip1-hip3-bounded-serialization',
  maxSpotPositionTraceBytes: 2_000,
  maxHip1DeploymentTraceBytes: 2_400,
  maxHip3FeeTraceBytes: 2_800,
  maxPortfolioTraceGrowthBytes: 180_000,
  maxOneThousandTwentyFourPortfolioResultBytes: 420_000,
}

let sink

function runBatch(operation) {
  const started = performance.now()
  for (let index = 0; index < limits.iterationsPerBatch; index += 1) {
    sink = operation()
  }
  return ((performance.now() - started) * 1_000_000) / limits.iterationsPerBatch
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

const kernel = () => normalizeDecimalString('000123.45000')
const facade = () => canonicalizeDecimalString({ value: '000123.45000' })

for (let index = 0; index < limits.warmupBatches; index += 1) {
  runBatch(kernel)
  runBatch(facade)
}

const kernelSamples = []
const facadeSamples = []
for (let index = 0; index < limits.measuredBatches; index += 1) {
  kernelSamples.push(runBatch(kernel))
  facadeSamples.push(runBatch(facade))
}

const kernelMedianNs = median(kernelSamples)
const facadeMedianNs = median(facadeSamples)
const ratio = facadeMedianNs / kernelMedianNs
const serializedBytes = Buffer.byteLength(JSON.stringify(facade()))

const twentyLevelBook = {
  levels: [
    Array.from({ length: 20 }, (_, index) => ({
      px: String(100 - index),
      sz: '1',
      n: 1,
    })),
    Array.from({ length: 20 }, (_, index) => ({
      px: String(101 + index),
      sz: '1',
      n: 1,
    })),
  ],
}
const oneLevelBook = {
  levels: [twentyLevelBook.levels[0].slice(0, 1), twentyLevelBook.levels[1].slice(0, 1)],
}
const metricsResult = calculateBookMetrics(twentyLevelBook)
const oneLevelFillResult = simulateBookFill({
  ...oneLevelBook,
  side: 'buy',
  amount: { kind: 'size', value: '1' },
  referencePrice: '100',
})
const twentyLevelFillResult = simulateBookFill({
  ...twentyLevelBook,
  side: 'buy',
  amount: { kind: 'size', value: '20' },
  referencePrice: '100',
})
const metricsTraceBytes = Buffer.byteLength(JSON.stringify(metricsResult.trace))
const oneLevelFillTraceBytes = Buffer.byteLength(JSON.stringify(oneLevelFillResult.trace))
const fillTraceBytes = Buffer.byteLength(JSON.stringify(twentyLevelFillResult.trace))
const fillTraceGrowthBytes = fillTraceBytes - oneLevelFillTraceBytes
const twentyLevelFillResultBytes = Buffer.byteLength(JSON.stringify(twentyLevelFillResult))

const positionFill = {
  side: 'buy',
  size: '1',
  price: '100',
  fee: { kind: 'none' },
}
const fillProjection = projectPerpFill({
  position: { kind: 'open', signedSize: '2', entryPrice: '100' },
  fill: {
    side: 'sell',
    size: '3',
    price: '101',
    fee: { kind: 'explicit', amount: '0.1' },
  },
})
const oneFillSequence = projectPerpFillSequence({
  position: { kind: 'flat' },
  fills: [positionFill],
})
const twoThousandFillSequence = projectPerpFillSequence({
  position: { kind: 'flat' },
  fills: Array.from({ length: 2_000 }, () => positionFill),
})
const fundingRate = calculateFundingRate({
  averagePremiumIndex: '0.01',
  rules: {
    interestRate: '0.0001',
    clampLower: '-0.0005',
    clampUpper: '0.0005',
    baseIntervalHours: 8,
    hourlyCap: '0.04',
  },
})
const fillProjectionTraceBytes = Buffer.byteLength(JSON.stringify(fillProjection.trace))
const oneFillSequenceTraceBytes = Buffer.byteLength(JSON.stringify(oneFillSequence.trace))
const sequenceTraceBytes = Buffer.byteLength(JSON.stringify(twoThousandFillSequence.trace))
const sequenceTraceGrowthBytes = sequenceTraceBytes - oneFillSequenceTraceBytes
const twoThousandFillResultBytes = Buffer.byteLength(JSON.stringify(twoThousandFillSequence))
const fundingRateTraceBytes = Buffer.byteLength(JSON.stringify(fundingRate.trace))

const portfolioBalance = (index) => ({
  tokenKey: `hl:mainnet:spot:TOKEN-${index}:0`,
  balance: '123.456789',
  entryPrice: '9.87654321',
  markPrice: '10.12345678',
})
const oneTokenPortfolio = calculateSpotPortfolioValue({ balances: [portfolioBalance(0)] })
const oneThousandTwentyFourTokenPortfolio = calculateSpotPortfolioValue({
  balances: Array.from({ length: 1_024 }, (_, index) => portfolioBalance(index)),
})
const spotPosition = projectSpotPositionEvent({
  position: { kind: 'open', balance: '2', entryPrice: '100' },
  event: { kind: 'sell', size: '1', price: '101', feeQuoteAmount: '0.1' },
})
const hip1Deployment = validateHip1Deployment({
  name: 'HYPE',
  weiDecimals: 8,
  szDecimals: 3,
  maxSupplyWei: '1000000000000',
  userGenesisWei: '600000000000',
  anchorGenesisWei: '400000000000',
})
const hip3Fee = calculateHip3FeeRates({
  makerRate: '-0.0001',
  takerRate: '0.0004',
  activeReferralDiscount: '0.04',
  isAlignedQuoteToken: true,
  deployerFeeScale: '0.5',
  growthMode: true,
})
const oneTokenPortfolioTraceBytes = Buffer.byteLength(JSON.stringify(oneTokenPortfolio.trace))
const portfolioTraceBytes = Buffer.byteLength(
  JSON.stringify(oneThousandTwentyFourTokenPortfolio.trace),
)
const portfolioTraceGrowthBytes = portfolioTraceBytes - oneTokenPortfolioTraceBytes
const oneThousandTwentyFourPortfolioResultBytes = Buffer.byteLength(
  JSON.stringify(oneThousandTwentyFourTokenPortfolio),
)
const spotPositionTraceBytes = Buffer.byteLength(JSON.stringify(spotPosition.trace))
const hip1DeploymentTraceBytes = Buffer.byteLength(JSON.stringify(hip1Deployment.trace))
const hip3FeeTraceBytes = Buffer.byteLength(JSON.stringify(hip3Fee.trace))

if (process.argv.includes('--record')) {
  await writeFile(baselinePath, `${JSON.stringify(limits, null, 2)}\n`)
  await writeFile(m1BaselinePath, `${JSON.stringify(m1Limits, null, 2)}\n`)
  await writeFile(m2BaselinePath, `${JSON.stringify(m2Limits, null, 2)}\n`)
  await writeFile(m5BaselinePath, `${JSON.stringify(m5Limits, null, 2)}\n`)
} else {
  const recorded = JSON.parse(await readFile(baselinePath, 'utf8'))
  if (JSON.stringify(recorded) !== JSON.stringify(limits)) {
    throw new Error('benchmarks/m0-baseline.json does not match the reviewed M0 budget')
  }
  if (ratio > limits.maxFacadeToKernelRatio) {
    throw new Error(
      `Facade/kernel ratio ${ratio.toFixed(2)} exceeds ${limits.maxFacadeToKernelRatio}`,
    )
  }
  if (serializedBytes > limits.maxSerializedBytes) {
    throw new Error(
      `Serialized result ${serializedBytes} exceeds ${limits.maxSerializedBytes} bytes`,
    )
  }

  const recordedM1 = JSON.parse(await readFile(m1BaselinePath, 'utf8'))
  if (JSON.stringify(recordedM1) !== JSON.stringify(m1Limits)) {
    throw new Error('benchmarks/m1-baseline.json does not match the reviewed M1 budget')
  }
  const m1Measurements = {
    metricsTraceBytes,
    fillTraceBytes,
    fillTraceGrowthBytes,
    twentyLevelFillResultBytes,
  }
  for (const [measurement, value] of Object.entries(m1Measurements)) {
    const limitName =
      measurement === 'twentyLevelFillResultBytes'
        ? 'maxTwentyLevelFillResultBytes'
        : `max${measurement[0].toUpperCase()}${measurement.slice(1)}`
    const limit = m1Limits[limitName]
    if (value > limit) throw new Error(`${measurement} ${value} exceeds ${limit}`)
  }

  const recordedM2 = JSON.parse(await readFile(m2BaselinePath, 'utf8'))
  if (JSON.stringify(recordedM2) !== JSON.stringify(m2Limits)) {
    throw new Error('benchmarks/m2-baseline.json does not match the reviewed M2 budget')
  }
  const m2Measurements = {
    fillProjectionTraceBytes,
    fundingRateTraceBytes,
    sequenceTraceBytes,
    sequenceTraceGrowthBytes,
    twoThousandFillResultBytes,
  }
  for (const [measurement, value] of Object.entries(m2Measurements)) {
    const limitName = `max${measurement[0].toUpperCase()}${measurement.slice(1)}`
    const limit = m2Limits[limitName]
    if (value > limit) throw new Error(`${measurement} ${value} exceeds ${limit}`)
  }

  const recordedM5 = JSON.parse(await readFile(m5BaselinePath, 'utf8'))
  if (JSON.stringify(recordedM5) !== JSON.stringify(m5Limits)) {
    throw new Error('benchmarks/m5-baseline.json does not match the reviewed M5 budget')
  }
  const m5Measurements = {
    spotPositionTraceBytes,
    hip1DeploymentTraceBytes,
    hip3FeeTraceBytes,
    portfolioTraceGrowthBytes,
    oneThousandTwentyFourPortfolioResultBytes,
  }
  for (const [measurement, value] of Object.entries(m5Measurements)) {
    const limitName = `max${measurement[0].toUpperCase()}${measurement.slice(1)}`
    const limit = m5Limits[limitName]
    if (value > limit) throw new Error(`${measurement} ${value} exceeds ${limit}`)
  }
}

console.log(
  JSON.stringify({
    kernelMedianNs,
    facadeMedianNs,
    ratio,
    serializedBytes,
    metricsTraceBytes,
    fillTraceBytes,
    fillTraceGrowthBytes,
    twentyLevelFillResultBytes,
    fillProjectionTraceBytes,
    fundingRateTraceBytes,
    sequenceTraceBytes,
    sequenceTraceGrowthBytes,
    twoThousandFillResultBytes,
    spotPositionTraceBytes,
    hip1DeploymentTraceBytes,
    hip3FeeTraceBytes,
    portfolioTraceGrowthBytes,
    oneThousandTwentyFourPortfolioResultBytes,
    sinkType: typeof sink,
  }),
)
