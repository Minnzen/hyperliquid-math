import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { resolveHip3CollateralSource } from '../../../src/hip3/index.js'

describe('HIP-3 collateral source properties', () => {
  it('uses token-index equality as the only deprecated USDC route predicate', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
        (collateralTokenIndex, validatorPerpUsdcTokenIndex) => {
          const result = resolveHip3CollateralSource({
            accountAbstractionMode: 'dex-abstraction-deprecated',
            dex: 'USDC',
            collateralTokenIndex,
            validatorPerpUsdcTokenIndex,
          })

          expect(result.value.status).toBe('ok')
          if (result.value.status !== 'ok') return
          expect(result.value.data.route.kind).toBe(
            collateralTokenIndex === validatorPerpUsdcTokenIndex
              ? 'validator-perp-usdc-balance'
              : 'spot-balance',
          )
        },
      ),
    )
  })
})
