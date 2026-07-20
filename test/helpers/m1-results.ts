import {
  calculateBookMetrics,
  decodeAssetId,
  deriveCanonicalAssetKey,
  encodeAssetId,
  quantizePrice,
  quantizeSize,
  simulateBookFill,
} from '../../src/index.js'

const book = {
  levels: [
    [
      { px: '100', sz: '2', n: 1 },
      { px: '99', sz: '3', n: 1 },
    ],
    [
      { px: '101', sz: '1.5', n: 2 },
      { px: '102', sz: '4', n: 1 },
    ],
  ],
} as const

export function m1Results() {
  return {
    price: quantizePrice({
      value: '12345.67891',
      marketKind: 'perp',
      szDecimals: 2,
      rounding: 'down',
    }),
    size: quantizeSize({ value: '01.234567', szDecimals: 3 }),
    assetKey: deriveCanonicalAssetKey({
      network: 'mainnet',
      marketKind: 'spot',
      dex: null,
      index: 0,
    }),
    encodedAssetId: encodeAssetId({ kind: 'hip3-perp', dexIndex: 1, index: 7 }),
    decodedAssetId: decodeAssetId({ assetId: 110007 }),
    metrics: calculateBookMetrics(book),
    fill: simulateBookFill({
      ...book,
      side: 'buy',
      amount: { kind: 'notional', value: '200', szDecimals: 2 },
      referencePrice: '100',
    }),
  }
}
