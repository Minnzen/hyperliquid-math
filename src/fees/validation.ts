import {
  exactPlainArray,
  exactPlainObject,
  normalizeDecimalAt,
  ownDataValue,
} from '../core/validation.js'
import type { MathIssue, MathReason } from '../model/index.js'
import type {
  NormalizedFeeRates,
  NormalizedFeeTier,
  NormalizedSelectFeeTierInput,
  NormalizedTradeFeeInput,
  NormalizedWeightedFeeVolumeInput,
} from './types.js'

export function reason(code: string, path: string): MathReason {
  return { code, path }
}

export function normalizeTradeFeeInput(
  input: unknown,
):
  | { readonly ok: true; readonly value: NormalizedTradeFeeInput }
  | { readonly ok: false; readonly issue: MathIssue } {
  const root = exactPlainObject(input, ['price', 'size', 'rate'], '')
  if (!root.ok) return { ok: false, issue: root.issue }

  const price = normalizeDecimalAt(ownDataValue(root.object, 'price'), '/price', 'positive')
  if (!price.ok) return { ok: false, issue: price.issue }
  const size = normalizeDecimalAt(ownDataValue(root.object, 'size'), '/size', 'non-negative')
  if (!size.ok) return { ok: false, issue: size.issue }
  const rate = normalizeDecimalAt(ownDataValue(root.object, 'rate'), '/rate', 'signed')
  if (!rate.ok) return { ok: false, issue: rate.issue }

  return {
    ok: true,
    value: {
      price: price.value,
      priceDecimal: price.decimal,
      size: size.value,
      sizeDecimal: size.decimal,
      rate: rate.value,
      rateDecimal: rate.decimal,
    },
  }
}

export function normalizeWeightedFeeVolumeInput(
  input: unknown,
):
  | { readonly ok: true; readonly value: NormalizedWeightedFeeVolumeInput }
  | { readonly ok: false; readonly issue: MathIssue } {
  const root = exactPlainObject(input, ['perpsVolume', 'spotVolume'], '')
  if (!root.ok) return { ok: false, issue: root.issue }

  const perpsVolume = normalizeDecimalAt(
    ownDataValue(root.object, 'perpsVolume'),
    '/perpsVolume',
    'non-negative',
  )
  if (!perpsVolume.ok) return { ok: false, issue: perpsVolume.issue }
  const spotVolume = normalizeDecimalAt(
    ownDataValue(root.object, 'spotVolume'),
    '/spotVolume',
    'non-negative',
  )
  if (!spotVolume.ok) return { ok: false, issue: spotVolume.issue }

  return {
    ok: true,
    value: {
      perpsVolume: perpsVolume.value,
      perpsVolumeDecimal: perpsVolume.decimal,
      spotVolume: spotVolume.value,
      spotVolumeDecimal: spotVolume.decimal,
    },
  }
}

function normalizeRates(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly value: NormalizedFeeRates }
  | { readonly ok: false; readonly issue: MathIssue } {
  const rates = exactPlainObject(input, ['makerRate', 'takerRate'], path)
  if (!rates.ok) return { ok: false, issue: rates.issue }

  const makerRate = normalizeDecimalAt(
    ownDataValue(rates.object, 'makerRate'),
    `${path}/makerRate`,
    'signed',
  )
  if (!makerRate.ok) return { ok: false, issue: makerRate.issue }
  const takerRate = normalizeDecimalAt(
    ownDataValue(rates.object, 'takerRate'),
    `${path}/takerRate`,
    'signed',
  )
  if (!takerRate.ok) return { ok: false, issue: takerRate.issue }

  return {
    ok: true,
    value: {
      makerRate: makerRate.value,
      makerRateDecimal: makerRate.decimal,
      takerRate: takerRate.value,
      takerRateDecimal: takerRate.decimal,
    },
  }
}

function normalizeTier(
  input: unknown,
  index: number,
):
  | { readonly ok: true; readonly value: NormalizedFeeTier }
  | { readonly ok: false; readonly issue: MathIssue } {
  const path = `/tiers/${index}`
  const tier = exactPlainObject(input, ['minimumWeightedVolume', 'makerRate', 'takerRate'], path)
  if (!tier.ok) return { ok: false, issue: tier.issue }

  const minimumWeightedVolume = normalizeDecimalAt(
    ownDataValue(tier.object, 'minimumWeightedVolume'),
    `${path}/minimumWeightedVolume`,
    'positive',
  )
  if (!minimumWeightedVolume.ok) return { ok: false, issue: minimumWeightedVolume.issue }
  const rates = normalizeRates(
    {
      makerRate: ownDataValue(tier.object, 'makerRate'),
      takerRate: ownDataValue(tier.object, 'takerRate'),
    },
    path,
  )
  if (!rates.ok) return { ok: false, issue: rates.issue }

  return {
    ok: true,
    value: {
      minimumWeightedVolume: minimumWeightedVolume.value,
      minimumWeightedVolumeDecimal: minimumWeightedVolume.decimal,
      ...rates.value,
    },
  }
}

export function normalizeSelectFeeTierInput(
  input: unknown,
):
  | { readonly ok: true; readonly value: NormalizedSelectFeeTierInput }
  | { readonly ok: false; readonly issue: MathIssue } {
  const root = exactPlainObject(input, ['weightedVolume', 'baseRates', 'tiers'], '')
  if (!root.ok) return { ok: false, issue: root.issue }

  const weightedVolume = normalizeDecimalAt(
    ownDataValue(root.object, 'weightedVolume'),
    '/weightedVolume',
    'non-negative',
  )
  if (!weightedVolume.ok) return { ok: false, issue: weightedVolume.issue }
  const baseRates = normalizeRates(ownDataValue(root.object, 'baseRates'), '/baseRates')
  if (!baseRates.ok) return { ok: false, issue: baseRates.issue }

  const tiersInput = exactPlainArray(ownDataValue(root.object, 'tiers'), '/tiers', {
    maxLength: 128,
  })
  if (!tiersInput.ok) return { ok: false, issue: tiersInput.issue }

  const tiers: NormalizedFeeTier[] = []
  let previous: NormalizedFeeTier | undefined
  for (const [index, rawTier] of tiersInput.values.entries()) {
    const tier = normalizeTier(rawTier, index)
    if (!tier.ok) return { ok: false, issue: tier.issue }
    if (
      previous !== undefined &&
      !tier.value.minimumWeightedVolumeDecimal.gt(previous.minimumWeightedVolumeDecimal)
    ) {
      return {
        ok: false,
        issue: {
          code: 'non-increasing-fee-tier-threshold',
          path: `/tiers/${index}/minimumWeightedVolume`,
          actual: tier.value.minimumWeightedVolume,
          expected: 'strictly increasing positive weighted-volume threshold',
        },
      }
    }
    tiers.push(tier.value)
    previous = tier.value
  }

  return {
    ok: true,
    value: {
      weightedVolume: weightedVolume.value,
      weightedVolumeDecimal: weightedVolume.decimal,
      baseRates: baseRates.value,
      tiers,
    },
  }
}
