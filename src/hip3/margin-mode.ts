import type { ConstraintCheck, MathResult } from '../model/index.js'
import { marginModeTrace } from './trace.js'
import type {
  EvaluateHip3MarginModeInput,
  Hip3MarginModeEvaluation,
  Hip3RequestedMarginMode,
} from './types.js'
import { normalizeEvaluateHip3MarginModeInput, reason } from './validation.js'

/**
 * Evaluates whether a requested cross/isolated mode is locally supported by the asset's official
 * margin mode: `noCross` and `strictIsolated` reject cross; isolated requests map to
 * `marginRemoval` `allowed` (or `strict` under `strictIsolated`) for the M3 margin/liquidation
 * inputs. A `normal` + cross request stays `not-evaluated` on eligibility — validator
 * requirements are server-authoritative. No `setMarginModes` action is submitted (experimental).
 *
 * @public
 */
export function evaluateHip3MarginMode(
  input: EvaluateHip3MarginModeInput,
): MathResult<Hip3MarginModeEvaluation> {
  const normalized = normalizeEvaluateHip3MarginModeInput(input)
  if (!normalized.ok) {
    return {
      value: { status: 'invalid-input', issues: [normalized.issue] },
      trace: marginModeTrace(undefined, {
        status: 'incomplete',
        reason: reason(normalized.issue.code, normalized.issue.path as string),
      }),
    }
  }

  const value = normalized.value
  const supportsCross = value.assetMarginMode === 'normal'
  const supportedLocally = value.requestedMode === 'isolated' || supportsCross
  const checks: ConstraintCheck[] = supportedLocally
    ? [{ status: 'satisfied', ruleId: 'hl.hip3.margin-mode.local-support' }]
    : [
        {
          status: 'violated',
          ruleId: 'hl.hip3.margin-mode.local-support',
          violation: {
            ruleId: 'hl.hip3.margin-mode.local-support',
            code: 'cross-margin-not-supported',
            path: '/requestedMode',
          },
        },
      ]

  if (value.assetMarginMode === 'normal' && value.requestedMode === 'cross') {
    checks.push({
      status: 'not-evaluated',
      ruleId: 'hl.hip3.cross-margin-server-eligibility',
      reason: reason('server-authoritative', '/requestedMode'),
    })
  }

  let effectiveMarginMode: Hip3RequestedMarginMode | null = null
  let marginRemoval: Hip3MarginModeEvaluation['marginRemoval'] = 'not-applicable'
  if (supportedLocally) {
    effectiveMarginMode = value.requestedMode
    if (value.requestedMode === 'isolated') {
      marginRemoval = value.assetMarginMode === 'strictIsolated' ? 'strict' : 'allowed'
    }
  }

  return {
    value: {
      status: 'ok',
      data: { supportedLocally, effectiveMarginMode, marginRemoval, checks },
    },
    trace: marginModeTrace(value, { status: 'complete' }, [
      {
        stepId: 'hip3-margin-actions-not-submitted',
        output: 'local-capability-check-only',
      },
      {
        stepId: 'margin-mode-evaluation',
        inputs: {
          assetMarginMode: value.assetMarginMode,
          requestedMode: value.requestedMode,
        },
        output: { supportedLocally, effectiveMarginMode, marginRemoval },
      },
    ]),
  }
}
