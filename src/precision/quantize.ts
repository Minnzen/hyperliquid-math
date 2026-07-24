import { type Decimal40, normalizeDecimalString } from '../core/decimal.js'
import { finalizeTrace } from '../core/finalize-trace.js'
import { describePlainValue } from '../core/plain-data.js'
import { invalidInputResult, okResult } from '../core/result.js'
import type {
  CalculationTrace,
  JsonObject,
  MathIssue,
  MathResult,
  RoundingDecision,
  TraceStep,
} from '../model/index.js'
import { quantizeProtocolPrice, quantizeProtocolSize } from './internal.js'

/** @public */
export interface QuantizePriceInput {
  /** Positive plain decimal string; JSON numbers are rejected (`invalid-decimal-string`). */
  readonly value: string
  readonly marketKind: 'perp' | 'spot'
  /** Official `meta.universe[].szDecimals` (spot: token metadata), as a plain number. */
  readonly szDecimals: number
  /** Explicit caller direction; prices are positive, so `down` is toward zero, `up` away. */
  readonly rounding: 'down' | 'up'
}

/** @public */
export interface QuantizeSizeInput {
  /** Positive unsigned plain decimal string (size carries no sign; direction is separate). */
  readonly value: string
  /** Official `meta.universe[].szDecimals` (spot: token metadata), as a plain number. */
  readonly szDecimals: number
}

/** @public */
export interface QuantizedDecimal {
  /** Canonical protocol-valid decimal string, no exponent or trailing zeroes. */
  readonly value: string
  /** True when quantization changed the numeric value (not merely the spelling). */
  readonly precisionChanged: boolean
}

type QuantizeInputShape =
  | {
      readonly ok: true
      readonly value: string
      readonly marketKind?: unknown
      readonly szDecimals: number
      readonly rounding?: unknown
    }
  | { readonly ok: false; readonly issue: MathIssue }

type DecimalValue = InstanceType<typeof Decimal40>

const priceSourceRefs = [
  'HLM.SPEC.PRECISION.PRICE.V1',
  'HL.DOC.TICK_LOT.2026-07-19',
  'HL.DOC.SIGNING.2026-07-19',
  'DECIMALJS.10.6.0',
] as const

const sizeSourceRefs = [
  'HLM.SPEC.PRECISION.SIZE.V1',
  'HL.DOC.TICK_LOT.2026-07-19',
  'HL.DOC.SIGNING.2026-07-19',
  'DECIMALJS.10.6.0',
] as const

function invalidInputShapeIssue(expected: string, actual: string): MathIssue {
  return {
    code: 'invalid-input-shape',
    path: '',
    actual,
    expected,
  }
}

function invalidInputShape(expected: string, actual: string): QuantizeInputShape {
  return {
    ok: false,
    issue: invalidInputShapeIssue(expected, actual),
  }
}

function ownDataDescriptor(input: object, key: string): PropertyDescriptor | undefined {
  const descriptor = Reflect.getOwnPropertyDescriptor(input, key)
  if (
    descriptor === undefined ||
    !Object.hasOwn(descriptor, 'value') ||
    descriptor.enumerable !== true
  ) {
    return undefined
  }
  return descriptor
}

function normalizeObjectShape(input: unknown, keys: readonly string[]): object | MathIssue {
  if (typeof input !== 'object' || input === null) {
    return invalidInputShapeIssue(
      `plain object with exactly ${keys.length} own data fields`,
      describePlainValue(input),
    )
  }

  try {
    if (Array.isArray(input)) {
      return invalidInputShapeIssue(
        `plain object with exactly ${keys.length} own data fields`,
        'array',
      )
    }

    const prototype = Object.getPrototypeOf(input) as object | null
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidInputShapeIssue(
        `plain object with exactly ${keys.length} own data fields`,
        'non-plain-object',
      )
    }

    const ownKeys = Reflect.ownKeys(input)
    const expectedKeys = [...keys].sort()
    const actualKeys = ownKeys.map((key) => String(key)).sort()
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index])
    ) {
      return invalidInputShapeIssue(
        `plain object with exactly these own data fields: ${expectedKeys.join(', ')}`,
        actualKeys.join(','),
      )
    }

    for (const key of keys) {
      if (ownDataDescriptor(input, key) === undefined) {
        return invalidInputShapeIssue(
          `plain object with exactly these own enumerable data fields: ${expectedKeys.join(', ')}`,
          key,
        )
      }
    }

    return input
  } catch {
    return invalidInputShapeIssue(
      `plain object with exactly ${keys.length} own data fields`,
      'uninspectable-object',
    )
  }
}

function isMathIssue(value: object | MathIssue): value is MathIssue {
  return 'code' in value && typeof value.code === 'string'
}

function normalizePriceInputShape(input: unknown): QuantizeInputShape {
  const shape = normalizeObjectShape(input, ['value', 'marketKind', 'szDecimals', 'rounding'])
  if (isMathIssue(shape)) return { ok: false, issue: shape }

  const value = ownDataDescriptor(shape, 'value')?.value
  const marketKind = ownDataDescriptor(shape, 'marketKind')?.value
  const szDecimals = ownDataDescriptor(shape, 'szDecimals')?.value
  const rounding = ownDataDescriptor(shape, 'rounding')?.value
  if (typeof value !== 'string' || typeof szDecimals !== 'number') {
    return invalidInputShape('plain object with string value and safe-integer szDecimals', 'value')
  }

  return { ok: true, value, marketKind, szDecimals, rounding }
}

function normalizeSizeInputShape(input: unknown): QuantizeInputShape {
  const shape = normalizeObjectShape(input, ['value', 'szDecimals'])
  if (isMathIssue(shape)) return { ok: false, issue: shape }

  const value = ownDataDescriptor(shape, 'value')?.value
  const szDecimals = ownDataDescriptor(shape, 'szDecimals')?.value
  if (typeof value !== 'string' || typeof szDecimals !== 'number') {
    return invalidInputShape('plain object with string value and safe-integer szDecimals', 'value')
  }

  return { ok: true, value, szDecimals }
}

function issue(code: string, path: string, actual: string, expected: string): MathIssue {
  return { code, path, actual, expected }
}

function createTrace(input: {
  readonly formulaId: string
  readonly sourceRefs: readonly string[]
  readonly completion: CalculationTrace['completion']
  readonly normalizedInputs: JsonObject
  readonly intermediates?: readonly TraceStep[]
  readonly rounding?: readonly RoundingDecision[]
}): CalculationTrace {
  return finalizeTrace({
    formulaId: input.formulaId,
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'stable',
    completion: input.completion,
    normalizedInputs: input.normalizedInputs,
    intermediates: input.intermediates ?? [],
    rounding: input.rounding ?? [],
    assumptions: [],
    sourceRefs: input.sourceRefs,
  })
}

function incompleteTrace(
  formulaId: string,
  sourceRefs: readonly string[],
  issueValue: MathIssue,
  normalizedInputs: JsonObject,
): CalculationTrace {
  return createTrace({
    formulaId,
    sourceRefs,
    completion: {
      status: 'incomplete',
      reason: { code: issueValue.code, path: issueValue.path as string },
    },
    normalizedInputs,
  })
}

function canonical(decimal: DecimalValue): string {
  return decimal.toFixed()
}

function addRoundingStep(input: {
  readonly steps: TraceStep[]
  readonly decisions: RoundingDecision[]
  readonly stepId: string
  readonly reasonCode: string
  readonly before: DecimalValue
  readonly after: DecimalValue
  readonly parameters: JsonObject
  readonly mode: 'down' | 'up'
}) {
  if (input.before.equals(input.after)) return

  const before = canonical(input.before)
  const after = canonical(input.after)
  input.steps.push({
    stepId: input.stepId,
    inputs: { value: before, ...input.parameters, rounding: input.mode },
    output: after,
  })
  input.decisions.push({
    path: '/value',
    input: before,
    output: after,
    mode: input.mode,
    reasonCode: input.reasonCode,
  })
}

/**
 * Quantizes a positive price to protocol tick rules: at most `MAX_DECIMALS - szDecimals` decimal
 * places (`MAX_DECIMALS` = 6 perp / 8 spot), then at most 5 significant figures unless the
 * intermediate result is an integer. Rounding direction is the caller's explicit choice; a result
 * that would quantize to zero is `invalid-input` because it cannot represent a protocol price.
 *
 * @public
 */
export function quantizePrice(input: QuantizePriceInput): MathResult<QuantizedDecimal> {
  const shape = normalizePriceInputShape(input)
  if (!shape.ok) {
    return invalidInputResult(
      [shape.issue],
      incompleteTrace('hl.precision.price.quantize', priceSourceRefs, shape.issue, {}),
    )
  }

  const rawInputs = {
    value: shape.value,
    marketKind: describePlainValue(shape.marketKind),
    szDecimals: shape.szDecimals,
    rounding: describePlainValue(shape.rounding),
  }

  if (shape.marketKind !== 'perp' && shape.marketKind !== 'spot') {
    const invalid = issue(
      'invalid-market-kind',
      '/marketKind',
      describePlainValue(shape.marketKind),
      'perp or spot',
    )
    return invalidInputResult(
      [invalid],
      incompleteTrace('hl.precision.price.quantize', priceSourceRefs, invalid, rawInputs),
    )
  }

  if (shape.rounding !== 'down' && shape.rounding !== 'up') {
    const invalid = issue(
      'invalid-rounding',
      '/rounding',
      describePlainValue(shape.rounding),
      'down or up',
    )
    return invalidInputResult(
      [invalid],
      incompleteTrace('hl.precision.price.quantize', priceSourceRefs, invalid, rawInputs),
    )
  }

  const maxDecimals = shape.marketKind === 'perp' ? 6 : 8
  if (
    !Number.isSafeInteger(shape.szDecimals) ||
    shape.szDecimals < 0 ||
    shape.szDecimals > maxDecimals
  ) {
    const invalid = issue(
      'invalid-sz-decimals',
      '/szDecimals',
      String(shape.szDecimals),
      `safe integer between 0 and ${maxDecimals}`,
    )
    return invalidInputResult(
      [invalid],
      incompleteTrace('hl.precision.price.quantize', priceSourceRefs, invalid, rawInputs),
    )
  }

  const normalized = normalizeDecimalString(shape.value)
  if (!normalized.ok) {
    return invalidInputResult(
      [normalized.issue],
      incompleteTrace('hl.precision.price.quantize', priceSourceRefs, normalized.issue, rawInputs),
    )
  }

  const normalizedInputs = {
    value: normalized.value,
    marketKind: shape.marketKind,
    szDecimals: shape.szDecimals,
    rounding: shape.rounding,
  }

  if (!normalized.decimal.gt(0)) {
    const invalid = issue('non-positive-decimal', '/value', normalized.value, 'positive decimal')
    return invalidInputResult(
      [invalid],
      incompleteTrace('hl.precision.price.quantize', priceSourceRefs, invalid, normalizedInputs),
    )
  }

  const quantized = quantizeProtocolPrice(
    normalized.decimal,
    maxDecimals,
    shape.szDecimals,
    shape.rounding,
  )
  const decimalPlaces = quantized.decimalPlaces
  const decimalRounded = quantized.decimalCandidate
  const finalRounded = quantized.value

  if (finalRounded.isZero()) {
    const invalid = issue('rounded-to-zero', '/value', normalized.value, 'positive protocol price')
    return invalidInputResult(
      [invalid],
      incompleteTrace('hl.precision.price.quantize', priceSourceRefs, invalid, normalizedInputs),
    )
  }

  const steps: TraceStep[] = []
  const decisions: RoundingDecision[] = []
  if (quantized.selectedRule === 'integer-exemption') {
    addRoundingStep({
      steps,
      decisions,
      stepId: 'price-integer-exemption',
      reasonCode: 'price-integer-exemption',
      before: normalized.decimal,
      after: finalRounded,
      parameters: { candidate: canonical(quantized.integerCandidate) },
      mode: shape.rounding,
    })
  } else {
    addRoundingStep({
      steps,
      decisions,
      stepId: 'price-decimal-places',
      reasonCode: 'price-max-decimal-places',
      before: normalized.decimal,
      after: decimalRounded,
      parameters: { decimalPlaces },
      mode: shape.rounding,
    })
    if (!decimalRounded.isInteger()) {
      addRoundingStep({
        steps,
        decisions,
        stepId: 'price-significant-figures',
        reasonCode: 'price-max-significant-figures',
        before: decimalRounded,
        after: finalRounded,
        parameters: { significantFigures: 5 },
        mode: shape.rounding,
      })
    }
  }

  return okResult(
    {
      value: canonical(finalRounded),
      precisionChanged: !normalized.decimal.equals(finalRounded),
    },
    createTrace({
      formulaId: 'hl.precision.price.quantize',
      sourceRefs: priceSourceRefs,
      completion: { status: 'complete' },
      normalizedInputs,
      intermediates: steps,
      rounding: decisions,
    }),
  )
}

/**
 * Quantizes a positive unsigned size down to `szDecimals` decimal places (always `down`, so the
 * requested exposure never increases). A result that would quantize to zero is `invalid-input`.
 *
 * @public
 */
export function quantizeSize(input: QuantizeSizeInput): MathResult<QuantizedDecimal> {
  const shape = normalizeSizeInputShape(input)
  if (!shape.ok) {
    return invalidInputResult(
      [shape.issue],
      incompleteTrace('hl.precision.size.quantize', sizeSourceRefs, shape.issue, {}),
    )
  }

  const rawInputs = { value: shape.value, szDecimals: shape.szDecimals }
  if (!Number.isSafeInteger(shape.szDecimals) || shape.szDecimals < 0 || shape.szDecimals > 8) {
    const invalid = issue(
      'invalid-sz-decimals',
      '/szDecimals',
      String(shape.szDecimals),
      'safe integer between 0 and 8',
    )
    return invalidInputResult(
      [invalid],
      incompleteTrace('hl.precision.size.quantize', sizeSourceRefs, invalid, rawInputs),
    )
  }

  const normalized = normalizeDecimalString(shape.value)
  if (!normalized.ok) {
    return invalidInputResult(
      [normalized.issue],
      incompleteTrace('hl.precision.size.quantize', sizeSourceRefs, normalized.issue, rawInputs),
    )
  }

  const normalizedInputs = { value: normalized.value, szDecimals: shape.szDecimals }
  if (!normalized.decimal.gt(0)) {
    const invalid = issue('non-positive-decimal', '/value', normalized.value, 'positive decimal')
    return invalidInputResult(
      [invalid],
      incompleteTrace('hl.precision.size.quantize', sizeSourceRefs, invalid, normalizedInputs),
    )
  }

  const rounded = quantizeProtocolSize(normalized.decimal, shape.szDecimals)
  if (rounded.isZero()) {
    const invalid = issue('rounded-to-zero', '/value', normalized.value, 'positive protocol size')
    return invalidInputResult(
      [invalid],
      incompleteTrace('hl.precision.size.quantize', sizeSourceRefs, invalid, normalizedInputs),
    )
  }

  const steps: TraceStep[] = []
  const decisions: RoundingDecision[] = []
  addRoundingStep({
    steps,
    decisions,
    stepId: 'size-decimal-places',
    reasonCode: 'size-max-decimal-places',
    before: normalized.decimal,
    after: rounded,
    parameters: { decimalPlaces: shape.szDecimals },
    mode: 'down',
  })

  return okResult(
    {
      value: canonical(rounded),
      precisionChanged: !normalized.decimal.equals(rounded),
    },
    createTrace({
      formulaId: 'hl.precision.size.quantize',
      sourceRefs: sizeSourceRefs,
      completion: { status: 'complete' },
      normalizedInputs,
      intermediates: steps,
      rounding: decisions,
    }),
  )
}
