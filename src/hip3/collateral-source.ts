import type { ConstraintCheck, MathResult } from '../model/index.js'
import { collateralSourceTrace } from './trace.js'
import type {
  Hip3CollateralSource,
  Hip3CollateralSourceRoute,
  ResolveHip3CollateralSourceInput,
} from './types.js'
import { normalizeResolveHip3CollateralSourceInput, reason } from './validation.js'

/**
 * Maps an explicit account-abstraction mode to the balance that collateralizes a HIP-3 DEX:
 * `standard` = per-DEX balance, `unified` = one shared spot balance, `portfolio` =
 * portfolio-margin route, and deprecated DEX abstraction = validator-perp USDC when
 * `collateralTokenIndex == validatorPerpUsdcTokenIndex`, else the spot balance.
 * A routing fact only — eligibility, borrow caps, and LTV are never evaluated (experimental).
 *
 * @public
 */
export function resolveHip3CollateralSource(
  input: ResolveHip3CollateralSourceInput,
): MathResult<Hip3CollateralSource> {
  const normalized = normalizeResolveHip3CollateralSourceInput(input)
  if (!normalized.ok) {
    return {
      value: { status: 'invalid-input', issues: [normalized.issue] },
      trace: collateralSourceTrace(undefined, {
        status: 'incomplete',
        reason: reason(normalized.issue.code, normalized.issue.path as string),
      }),
    }
  }

  const value = normalized.value
  let route: Hip3CollateralSourceRoute
  switch (value.accountAbstractionMode) {
    case 'standard':
      route = {
        kind: 'per-dex-balance',
        dex: value.dex,
        collateralTokenIndex: value.collateralTokenIndex,
      }
      break
    case 'unified':
      route = { kind: 'unified-spot-balance', collateralTokenIndex: value.collateralTokenIndex }
      break
    case 'portfolio':
      route = { kind: 'portfolio-margin', collateralTokenIndex: value.collateralTokenIndex }
      break
    case 'dex-abstraction-deprecated':
      route =
        value.collateralTokenIndex === value.validatorPerpUsdcTokenIndex
          ? { kind: 'validator-perp-usdc-balance' }
          : { kind: 'spot-balance', collateralTokenIndex: value.collateralTokenIndex }
      break
  }

  const checks: ConstraintCheck[] = [
    { status: 'satisfied', ruleId: 'hl.hip3.collateral-source.mode-supported' },
  ]
  if (value.accountAbstractionMode === 'portfolio') {
    checks.push({
      status: 'not-evaluated',
      ruleId: 'hl.hip3.portfolio-margin-eligibility',
      reason: reason('server-authoritative', '/accountAbstractionMode'),
    })
  }

  return {
    value: { status: 'ok', data: { route, checks } },
    trace: collateralSourceTrace(value, { status: 'complete' }, [
      {
        stepId: 'collateral-source-route',
        inputs: {
          accountAbstractionMode: value.accountAbstractionMode,
          collateralTokenIndex: value.collateralTokenIndex,
          validatorPerpUsdcTokenIndex: value.validatorPerpUsdcTokenIndex,
        },
        output: route,
      },
    ]),
  }
}
