import { Decimal40 } from '../core/decimal.js'
import { invalidInputResult } from '../core/result.js'
import type { ValidationIssue } from '../core/validation.js'
import type { ConstraintCheck, JsonObject, MathResult, TraceStep } from '../model/index.js'
import {
  hip1AnchorGenesisAssumptions,
  hip1AnchorGenesisTrace,
  hip1DeploymentAssumptions,
  hip1DeploymentTrace,
  hip1Reason,
} from './trace.js'
import type {
  EvaluateHip1AnchorGenesisEligibilityInput,
  Hip1AnchorGenesisEligibility,
  NormalizedHip1AnchorGenesisEligibilityInput,
  NormalizedHip1DeploymentInput,
  ValidatedHip1Deployment,
  ValidateHip1DeploymentInput,
} from './types.js'
import {
  assertDecimalArithmeticGuard,
  assertDecimalStringSignificantDigitGuard,
  countCodePoints,
  normalizeHip1AnchorGenesisEligibilityInput,
  normalizeHip1DeploymentInput,
} from './validation.js'

const decimalZero = new Decimal40('0')
const anchorGenesisDenominator = new Decimal40('1000000')
const anchorGenesisScale = 6

function invalid<T>(
  formulaId: 'deployment' | 'anchor-genesis',
  issue: ValidationIssue,
): MathResult<T> {
  const trace =
    formulaId === 'deployment'
      ? hip1DeploymentTrace({
          completion: { status: 'incomplete', reason: hip1Reason(issue.code, issue.path) },
        })
      : hip1AnchorGenesisTrace({
          completion: { status: 'incomplete', reason: hip1Reason(issue.code, issue.path) },
        })

  return invalidInputResult([issue], trace)
}

function satisfied(ruleId: string): ConstraintCheck {
  return { status: 'satisfied', ruleId }
}

function violated(ruleId: string, code: string, actual: string, limit?: string): ConstraintCheck {
  return {
    status: 'violated',
    ruleId,
    violation: {
      ruleId,
      code,
      actual,
      ...(limit === undefined ? {} : { limit }),
    },
  }
}

function normalizedDeploymentInputs(input: NormalizedHip1DeploymentInput): JsonObject {
  return {
    name: input.name,
    weiDecimals: input.weiDecimals,
    szDecimals: input.szDecimals,
    maxSupplyWei: input.maxSupplyWei,
    userGenesisWei: input.userGenesisWei,
    anchorGenesisWei: input.anchorGenesisWei,
  }
}

function normalizedAnchorInputs(input: NormalizedHip1AnchorGenesisEligibilityInput): JsonObject {
  return {
    holderBalanceWei: input.holderBalanceWei,
    anchorTokenMaxSupplyWei: input.anchorTokenMaxSupplyWei,
  }
}

function pow10String(exponent: number): string {
  if (exponent === 0) return '1'
  if (exponent > 0) return `1${'0'.repeat(exponent)}`
  return `0.${'0'.repeat(Math.abs(exponent) - 1)}1`
}

function fixed(decimal: InstanceType<typeof Decimal40>): string {
  return decimal.isZero() ? '0' : decimal.toFixed()
}

function stripLeadingZeros(value: string): string {
  return value.replace(/^0+(?=\d)/, '')
}

function compareUnsignedIntegerStrings(left: string, right: string): number {
  const normalizedLeft = stripLeadingZeros(left)
  const normalizedRight = stripLeadingZeros(right)
  if (normalizedLeft.length !== normalizedRight.length) {
    return normalizedLeft.length > normalizedRight.length ? 1 : -1
  }
  if (normalizedLeft === normalizedRight) return 0
  return normalizedLeft > normalizedRight ? 1 : -1
}

function subtractUnsignedIntegerStrings(left: string, right: string): string {
  let borrow = 0
  let output = ''
  let leftIndex = left.length - 1
  let rightIndex = right.length - 1

  while (leftIndex >= 0) {
    const leftDigit = Number(left[leftIndex]) - borrow
    const rightDigit = rightIndex >= 0 ? Number(right[rightIndex]) : 0
    if (leftDigit < rightDigit) {
      output = (leftDigit + 10 - rightDigit).toString() + output
      borrow = 1
    } else {
      output = (leftDigit - rightDigit).toString() + output
      borrow = 0
    }
    leftIndex -= 1
    rightIndex -= 1
  }

  return stripLeadingZeros(output)
}

function formatScaledInteger(value: string): string {
  const padded = value.padStart(anchorGenesisScale + 1, '0')
  const integer = stripLeadingZeros(padded.slice(0, -anchorGenesisScale))
  const fraction = padded.slice(-anchorGenesisScale).replace(/0+$/, '')
  return fraction.length === 0 ? integer : `${integer}.${fraction}`
}

function exactPositiveAnchorWeightWei(
  holderBalanceWei: string,
  anchorTokenMaxSupplyWei: string,
): string {
  const scaledHolderBalanceWei = `${holderBalanceWei}${'0'.repeat(anchorGenesisScale)}`
  if (compareUnsignedIntegerStrings(scaledHolderBalanceWei, anchorTokenMaxSupplyWei) <= 0) {
    return '0'
  }
  return formatScaledInteger(
    subtractUnsignedIntegerStrings(scaledHolderBalanceWei, anchorTokenMaxSupplyWei),
  )
}

function deploymentIntermediates(
  input: NormalizedHip1DeploymentInput,
  nameCodePoints: number,
  lotSizeWei: string,
  totalGenesisWei: string,
): readonly TraceStep[] {
  return [
    {
      stepId: 'hip1.name.code-point-count',
      inputs: { name: input.name },
      output: nameCodePoints,
    },
    {
      stepId: 'hip1.deployment.lot-size',
      inputs: { weiDecimals: input.weiDecimals, szDecimals: input.szDecimals },
      output: lotSizeWei,
    },
    {
      stepId: 'hip1.deployment.genesis-checksum',
      inputs: {
        userGenesisWei: input.userGenesisWei,
        anchorGenesisWei: input.anchorGenesisWei,
      },
      output: { totalGenesisWei, maxSupplyWei: input.maxSupplyWei },
    },
  ]
}

function anchorIntermediates(
  input: NormalizedHip1AnchorGenesisEligibilityInput,
  thresholdWei: string,
  weightWei: string,
): readonly TraceStep[] {
  return [
    {
      stepId: 'hip1.anchor-genesis.threshold',
      inputs: {
        anchorTokenMaxSupplyWei: input.anchorTokenMaxSupplyWei,
        denominator: '1000000',
      },
      output: thresholdWei,
    },
    {
      stepId: 'hip1.anchor-genesis.weight',
      inputs: {
        holderBalanceWei: input.holderBalanceWei,
        thresholdWei,
      },
      output: weightWei,
    },
  ]
}

/**
 * Validates the objective HIP-1 deployment constraints: name at most 6 code points,
 * `szDecimals + 5 <= weiDecimals`, positive max supply, integer wei amounts, and the genesis
 * checksum `userGenesisWei + anchorGenesisWei == maxSupplyWei`; also derives
 * `lotSizeWei = 10 ** (weiDecimals - szDecimals)`. Violated constraints come back as checks on an
 * `ok` result; auction state, deployer permissions, and server acceptance are never predicted.
 *
 * @public
 */
export function validateHip1Deployment(
  input: ValidateHip1DeploymentInput,
): MathResult<ValidatedHip1Deployment> {
  const normalized = normalizeHip1DeploymentInput(input)
  if (!normalized.ok) return invalid('deployment', normalized.issue)

  const value = normalized.value
  const totalGenesisWeiDecimal = value.userGenesisWeiDecimal.plus(value.anchorGenesisWeiDecimal)
  const totalGenesisWei = assertDecimalArithmeticGuard(totalGenesisWeiDecimal, '/genesisWei')
  if (!totalGenesisWei.ok) return invalid('deployment', totalGenesisWei.issue)

  const nameCodePoints = countCodePoints(value.name)
  const decimalConstraintActual = value.szDecimals + 5
  const lotSizeWei = pow10String(value.weiDecimals - value.szDecimals)
  const checks: ConstraintCheck[] = [
    nameCodePoints <= 6
      ? satisfied('hl.hip1.deployment.name-code-points')
      : violated(
          'hl.hip1.deployment.name-code-points',
          'name-too-long',
          nameCodePoints.toString(),
          '6',
        ),
    satisfied('hl.hip1.deployment.decimal-range'),
    decimalConstraintActual <= value.weiDecimals
      ? satisfied('hl.hip1.deployment.sz-decimals-within-wei')
      : violated(
          'hl.hip1.deployment.sz-decimals-within-wei',
          'sz-decimals-exceed-wei-decimals-minus-five',
          decimalConstraintActual.toString(),
          value.weiDecimals.toString(),
        ),
    value.maxSupplyWeiDecimal.gt(decimalZero)
      ? satisfied('hl.hip1.deployment.positive-max-supply')
      : violated('hl.hip1.deployment.positive-max-supply', 'non-positive-max-supply', '0'),
    totalGenesisWeiDecimal.eq(value.maxSupplyWeiDecimal)
      ? satisfied('hl.hip1.deployment.genesis-max-supply-checksum')
      : violated(
          'hl.hip1.deployment.genesis-max-supply-checksum',
          'genesis-max-supply-mismatch',
          totalGenesisWei.value,
          value.maxSupplyWei,
        ),
  ]

  return {
    value: {
      status: 'ok',
      data: {
        lotSizeWei,
        totalGenesisWei: totalGenesisWei.value,
        checks,
      },
    },
    trace: hip1DeploymentTrace({
      completion: { status: 'complete' },
      normalizedInputs: normalizedDeploymentInputs(value),
      intermediates: deploymentIntermediates(
        value,
        nameCodePoints,
        lotSizeWei,
        totalGenesisWei.value,
      ),
      assumptions: hip1DeploymentAssumptions(value),
    }),
  }
}

/**
 * Computes one holder's anchor-genesis weight
 * `weightWei = max(holderBalanceWei - anchorTokenMaxSupplyWei / 1000000, 0)` — positive weight
 * only above the 0.0001%-of-max-supply threshold — keeping the exact rational rather than
 * rounding. It evaluates a single holder; final cross-holder allocation and snapshot inclusion
 * stay server-side.
 *
 * @public
 */
export function evaluateHip1AnchorGenesisEligibility(
  input: EvaluateHip1AnchorGenesisEligibilityInput,
): MathResult<Hip1AnchorGenesisEligibility> {
  const normalized = normalizeHip1AnchorGenesisEligibilityInput(input)
  if (!normalized.ok) return invalid('anchor-genesis', normalized.issue)

  const value = normalized.value
  const thresholdWeiDecimal = value.anchorTokenMaxSupplyWeiDecimal.div(anchorGenesisDenominator)
  const thresholdWei = fixed(thresholdWeiDecimal)
  const exactWeightWei = exactPositiveAnchorWeightWei(
    value.holderBalanceWei,
    value.anchorTokenMaxSupplyWei,
  )
  const weightWei = assertDecimalStringSignificantDigitGuard(exactWeightWei, '/weightWei')
  if (!weightWei.ok) return invalid('anchor-genesis', weightWei.issue)
  const weightWeiDecimal = new Decimal40(weightWei.value)
  const data: Hip1AnchorGenesisEligibility = {
    thresholdWei,
    weightWei: weightWei.value,
    eligible: weightWeiDecimal.gt(decimalZero),
  }

  return {
    value: { status: 'ok', data },
    trace: hip1AnchorGenesisTrace({
      completion: { status: 'complete' },
      normalizedInputs: normalizedAnchorInputs(value),
      intermediates: anchorIntermediates(value, thresholdWei, weightWei.value),
      assumptions: hip1AnchorGenesisAssumptions(value),
    }),
  }
}
