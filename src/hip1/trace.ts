import { finalizeTrace } from '../core/finalize-trace.js'
import type {
  Assumption,
  CalculationTrace,
  JsonObject,
  MathReason,
  TraceStep,
} from '../model/index.js'
import type {
  NormalizedHip1AnchorGenesisEligibilityInput,
  NormalizedHip1DeploymentInput,
} from './types.js'

type TraceCompletion = CalculationTrace['completion']

export const hip1DeploymentSourceRefs = [
  'HLM.SPEC.HIP1.DEPLOYMENT_VALIDATE.V1',
  'HL.DOC.HIP1.2026-07-19',
  'HL.DOC.HIP1_DEPLOY.2026-07-19',
  'DECIMALJS.10.6.0',
] as const

export const hip1AnchorGenesisSourceRefs = [
  'HLM.SPEC.HIP1.ANCHOR_GENESIS_EVALUATE.V1',
  'HL.DOC.HIP1.2026-07-19',
  'DECIMALJS.10.6.0',
] as const

export function hip1Reason(code: string, path: string): MathReason {
  return { code, path }
}

export function hip1DeploymentAssumptions(
  input: NormalizedHip1DeploymentInput,
): readonly Assumption[] {
  return [
    {
      kind: 'frozen-input',
      path: '',
      value: {
        name: input.name,
        weiDecimals: input.weiDecimals,
        szDecimals: input.szDecimals,
        maxSupplyWei: input.maxSupplyWei,
        userGenesisWei: input.userGenesisWei,
        anchorGenesisWei: input.anchorGenesisWei,
      },
    },
    {
      kind: 'frozen-input',
      path: '/nameCharacterCounting',
      value: 'ECMAScript Unicode code points; no trim, normalization, or case folding',
    },
  ]
}

export function hip1AnchorGenesisAssumptions(
  input: NormalizedHip1AnchorGenesisEligibilityInput,
): readonly Assumption[] {
  return [
    {
      kind: 'frozen-input',
      path: '',
      value: {
        holderBalanceWei: input.holderBalanceWei,
        anchorTokenMaxSupplyWei: input.anchorTokenMaxSupplyWei,
      },
    },
  ]
}

export function hip1DeploymentTrace(input: {
  readonly completion: TraceCompletion
  readonly normalizedInputs?: JsonObject
  readonly intermediates?: readonly TraceStep[]
  readonly assumptions?: readonly Assumption[]
}): CalculationTrace {
  return finalizeTrace({
    formulaId: 'hl.hip1.deployment.validate',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'experimental',
    completion: input.completion,
    normalizedInputs: input.normalizedInputs ?? {},
    intermediates: input.intermediates ?? [],
    rounding: [],
    assumptions: input.assumptions ?? [],
    sourceRefs: hip1DeploymentSourceRefs,
  })
}

export function hip1AnchorGenesisTrace(input: {
  readonly completion: TraceCompletion
  readonly normalizedInputs?: JsonObject
  readonly intermediates?: readonly TraceStep[]
  readonly assumptions?: readonly Assumption[]
}): CalculationTrace {
  return finalizeTrace({
    formulaId: 'hl.hip1.anchor-genesis.evaluate',
    formulaVersion: 1,
    authority: 'local-exact',
    maturity: 'experimental',
    completion: input.completion,
    normalizedInputs: input.normalizedInputs ?? {},
    intermediates: input.intermediates ?? [],
    rounding: [],
    assumptions: input.assumptions ?? [],
    sourceRefs: hip1AnchorGenesisSourceRefs,
  })
}
