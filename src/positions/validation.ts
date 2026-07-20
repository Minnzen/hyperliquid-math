import { Decimal40 } from '../core/decimal.js'
import {
  exactPlainArray,
  exactPlainObject,
  issue,
  normalizeDecimalAt,
  ownDataValue,
  type ValidationIssue,
} from '../core/validation.js'
import type { MathReason } from '../model/index.js'
import type { NormalizedFill, NormalizedPosition, PerpFillFee } from './types.js'

export function reason(code: string, path: string): MathReason {
  return { code, path }
}

export function normalizePosition(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly position: NormalizedPosition }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['kind'], path)
  if (shape.ok && ownDataValue(shape.object, 'kind') === 'flat') {
    return { ok: true, position: { kind: 'flat' } }
  }

  const openShape = exactPlainObject(input, ['kind', 'signedSize', 'entryPrice'], path)
  if (!openShape.ok) return openShape

  if (ownDataValue(openShape.object, 'kind') !== 'open') {
    return {
      ok: false,
      issue: issue(
        'invalid-position-kind',
        `${path}/kind`,
        ownDataValue(openShape.object, 'kind'),
        'flat or open',
      ),
    }
  }

  const signedSize = normalizeDecimalAt(
    ownDataValue(openShape.object, 'signedSize'),
    `${path}/signedSize`,
    'signed',
  )
  if (!signedSize.ok) return signedSize
  if (signedSize.decimal.isZero()) {
    return {
      ok: false,
      issue: issue(
        'zero-open-position-size',
        `${path}/signedSize`,
        signedSize.value,
        'non-zero decimal string',
      ),
    }
  }

  const entryPrice = normalizeDecimalAt(
    ownDataValue(openShape.object, 'entryPrice'),
    `${path}/entryPrice`,
    'positive',
  )
  if (!entryPrice.ok) return entryPrice

  return {
    ok: true,
    position: {
      kind: 'open',
      signedSize: signedSize.value,
      signedSizeDecimal: signedSize.decimal,
      entryPrice: entryPrice.value,
      entryPriceDecimal: entryPrice.decimal,
    },
  }
}

function normalizeFee(
  input: unknown,
  path: string,
  price: InstanceType<typeof Decimal40>,
  size: InstanceType<typeof Decimal40>,
):
  | {
      readonly ok: true
      readonly fee: PerpFillFee
      readonly feeAmountDecimal: InstanceType<typeof Decimal40>
    }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const noneShape = exactPlainObject(input, ['kind'], path)
  if (noneShape.ok && ownDataValue(noneShape.object, 'kind') === 'none') {
    return { ok: true, fee: { kind: 'none' }, feeAmountDecimal: new Decimal40(0) }
  }

  const explicitShape = exactPlainObject(input, ['kind', 'amount'], path)
  if (explicitShape.ok && ownDataValue(explicitShape.object, 'kind') === 'explicit') {
    const amount = normalizeDecimalAt(
      ownDataValue(explicitShape.object, 'amount'),
      `${path}/amount`,
      'signed',
    )
    if (!amount.ok) return amount
    if (size.isZero() && !amount.decimal.isZero()) {
      return {
        ok: false,
        issue: issue(
          'non-zero-fee-for-zero-size',
          `${path}/amount`,
          amount.value,
          'zero when fill size is zero',
        ),
      }
    }
    return {
      ok: true,
      fee: { kind: 'explicit', amount: amount.value },
      feeAmountDecimal: amount.decimal,
    }
  }

  const rateShape = exactPlainObject(input, ['kind', 'rate'], path)
  if (rateShape.ok && ownDataValue(rateShape.object, 'kind') === 'rate') {
    const rate = normalizeDecimalAt(
      ownDataValue(rateShape.object, 'rate'),
      `${path}/rate`,
      'signed',
    )
    if (!rate.ok) return rate
    return {
      ok: true,
      fee: { kind: 'rate', rate: rate.value },
      feeAmountDecimal: price.mul(size).mul(rate.decimal),
    }
  }

  const kind = typeof input === 'object' && input !== null ? ownDataValue(input, 'kind') : input
  return {
    ok: false,
    issue: issue('invalid-fee-kind', `${path}/kind`, kind, 'none, explicit, or rate'),
  }
}

export function normalizeFill(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly fill: NormalizedFill }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const shape = exactPlainObject(input, ['side', 'size', 'price', 'fee'], path)
  if (!shape.ok) return shape

  const side = ownDataValue(shape.object, 'side')
  if (side !== 'buy' && side !== 'sell') {
    return {
      ok: false,
      issue: issue('invalid-fill-side', `${path}/side`, side, 'buy or sell'),
    }
  }

  const size = normalizeDecimalAt(
    ownDataValue(shape.object, 'size'),
    `${path}/size`,
    'non-negative',
  )
  if (!size.ok) return size

  const price = normalizeDecimalAt(ownDataValue(shape.object, 'price'), `${path}/price`, 'positive')
  if (!price.ok) return price

  const fee = normalizeFee(
    ownDataValue(shape.object, 'fee'),
    `${path}/fee`,
    price.decimal,
    size.decimal,
  )
  if (!fee.ok) return fee

  return {
    ok: true,
    fill: {
      side,
      size: size.value,
      sizeDecimal: size.decimal,
      price: price.value,
      priceDecimal: price.decimal,
      fee: fee.fee,
      feeAmountDecimal: fee.feeAmountDecimal,
    },
  }
}

export function normalizeFillArray(
  input: unknown,
  path: string,
):
  | { readonly ok: true; readonly fills: readonly NormalizedFill[] }
  | { readonly ok: false; readonly issue: ValidationIssue } {
  const array = exactPlainArray(input, path, { maxLength: 2000 })
  if (!array.ok) return array

  const fills: NormalizedFill[] = []
  for (let index = 0; index < array.values.length; index += 1) {
    const fill = normalizeFill(array.values[index], `${path}/${index}`)
    if (!fill.ok) return fill
    fills.push(fill.fill)
  }
  return { ok: true, fills }
}
