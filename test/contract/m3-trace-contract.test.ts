import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { simulatePerpAccountScenario } from '../../src/index.js'

const asset = {
  network: 'mainnet',
  marketKind: 'perp',
  dex: null,
  index: 0,
} as const

function scenarioWithUnsupportedReason(reason: unknown) {
  return simulatePerpAccountScenario({
    snapshot: {
      crossAccountValue: '1000',
      positions: [
        {
          kind: 'open',
          asset,
          signedSize: '2',
          entryPrice: '100',
          marginMode: { kind: 'cross' },
          leverage: '10',
        },
      ],
      markets: [
        {
          asset,
          markPrice: '100',
          maxLeverage: '20',
          marginTiers: [{ lowerBound: '0', maxLeverage: '20' }],
        },
      ],
    },
    actions: [
      {
        kind: 'set-leverage',
        asset,
        targetMode: 'cross',
        leverage: '10',
        marginEffect: { kind: 'not-supported', reason: reason as never },
      },
    ],
  })
}

describe('M3 public trace contract', () => {
  it('uses the reviewed authority and only registered source identifiers', async () => {
    const result = simulatePerpAccountScenario({
      snapshot: {
        crossAccountValue: '1000',
        positions: [
          {
            kind: 'open',
            asset,
            signedSize: '2',
            entryPrice: '100',
            marginMode: { kind: 'cross' },
            leverage: '10',
          },
        ],
        markets: [
          {
            asset,
            markPrice: '100',
            maxLeverage: '20',
            marginTiers: [{ lowerBound: '0', maxLeverage: '20' }],
          },
        ],
      },
      actions: [{ kind: 'cross-account-value-delta', amount: '5' }],
    })

    expect(result.trace.authority).toBe('local-exact')
    expect(result.trace.maturity).toBe('experimental')
    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') {
      return
    }

    const sourceRegistry = await readFile('spec/SOURCES.md', 'utf8')
    const registeredIds = new Set(
      [...sourceRegistry.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]),
    )
    const emittedSourceRefs = [
      ...result.trace.sourceRefs,
      ...result.value.data.actions.flatMap((action) => action.sourceRefs),
    ]

    expect(registeredIds.size).toBeGreaterThan(0)
    for (const sourceRef of emittedSourceRefs) {
      expect(registeredIds, `unregistered sourceRef: ${sourceRef}`).toContain(sourceRef)
    }
  })

  it.each(['path', 'details', 'sourceRefs'] as const)(
    'rejects an explicitly undefined reason.%s field',
    (field) => {
      const result = scenarioWithUnsupportedReason({ code: 'unsupported', [field]: undefined })

      expect(result.value).toMatchObject({
        status: 'invalid-input',
        issues: [{ code: 'invalid-input-shape', path: `/actions/0/marginEffect/reason/${field}` }],
      })
    },
  )

  it('rejects a non-JSON member inside reason details arrays', () => {
    const result = scenarioWithUnsupportedReason({
      code: 'unsupported',
      details: { values: [undefined] },
    })

    expect(result.value).toMatchObject({
      status: 'invalid-input',
      issues: [
        {
          code: 'invalid-input-shape',
          path: '/actions/0/marginEffect/reason/details/values/0',
        },
      ],
    })
  })

  it('reconstructs a __proto__ detail as data without changing the output prototype', () => {
    const details = Object.create(null) as Record<string, unknown>
    Object.defineProperty(details, '__proto__', {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
      writable: true,
    })

    const result = scenarioWithUnsupportedReason({ code: 'unsupported', details })

    expect(result.value.status).toBe('indeterminate')
    if (result.value.status !== 'indeterminate') {
      return
    }
    expect(result.value.reason.details).toBeDefined()
    expect(Object.getPrototypeOf(result.value.reason.details)).toBe(Object.prototype)
    expect(Object.hasOwn(result.value.reason.details ?? {}, '__proto__')).toBe(true)
    expect(
      Reflect.getOwnPropertyDescriptor(result.value.reason.details ?? {}, '__proto__')?.value,
    ).toEqual({ polluted: true })
  })
})
