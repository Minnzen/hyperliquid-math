import { Decimal40 } from '../core/decimal.js'

type DecimalValue = InstanceType<typeof Decimal40>

export interface ProtocolPriceQuantization {
  readonly decimalPlaces: number
  readonly decimalCandidate: DecimalValue
  readonly significantFigureCandidate: DecimalValue
  readonly integerCandidate: DecimalValue
  readonly value: DecimalValue
  readonly selectedRule: 'precision-limits' | 'integer-exemption'
}

export function quantizeProtocolPrice(
  value: DecimalValue,
  maxDecimals: number,
  szDecimals: number,
  rounding: 'down' | 'up',
): ProtocolPriceQuantization {
  const mode = rounding === 'down' ? Decimal40.ROUND_DOWN : Decimal40.ROUND_UP
  const decimalPlaces = maxDecimals - szDecimals
  const decimalCandidate = value.toDecimalPlaces(decimalPlaces, mode)
  const significantFigureCandidate = decimalCandidate.isInteger()
    ? decimalCandidate
    : decimalCandidate.toSignificantDigits(5, mode)
  const integerCandidate = value.toDecimalPlaces(0, mode)
  const selected =
    rounding === 'down'
      ? Decimal40.max(significantFigureCandidate, integerCandidate)
      : Decimal40.min(significantFigureCandidate, integerCandidate)
  const selectedRule =
    selected.eq(integerCandidate) && !selected.eq(significantFigureCandidate)
      ? 'integer-exemption'
      : 'precision-limits'

  return {
    decimalPlaces,
    decimalCandidate,
    significantFigureCandidate,
    integerCandidate,
    value: selected,
    selectedRule,
  }
}

export function quantizeProtocolSize(value: DecimalValue, szDecimals: number): DecimalValue {
  return value.toDecimalPlaces(szDecimals, Decimal40.ROUND_DOWN)
}
