import { describe, expect, it } from 'vitest'
import { projectPerpFill } from '../../../src/positions/index.js'

describe('position directed mutation-kill vectors', () => {
  it('kills a reduced-entry-reweights mutant', () => {
    const result = projectPerpFill({
      position: { kind: 'open', signedSize: '5', entryPrice: '100' },
      fill: { side: 'sell', size: '2', price: '110', fee: { kind: 'none' } },
    })
    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.nextState).toEqual({
      kind: 'open',
      signedSize: '3',
      entryPrice: '100',
    })
    expect(result.value.data.grossRealizedPnl).toBe('20')
  })

  it('kills a flip-fee-applies-only-to-closing-size mutant', () => {
    const result = projectPerpFill({
      position: { kind: 'open', signedSize: '2', entryPrice: '100' },
      fill: { side: 'sell', size: '3', price: '100', fee: { kind: 'rate', rate: '0.01' } },
    })
    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.feeAmount).toBe('3')
    expect(result.value.data.feeAmount).not.toBe('2')
  })

  it('kills a flip-remainder-keeps-old-entry mutant', () => {
    const result = projectPerpFill({
      position: { kind: 'open', signedSize: '-2', entryPrice: '80' },
      fill: { side: 'buy', size: '5', price: '100', fee: { kind: 'none' } },
    })
    expect(result.value.status).toBe('ok')
    if (result.value.status !== 'ok') return
    expect(result.value.data.nextState).toEqual({
      kind: 'open',
      signedSize: '3',
      entryPrice: '100',
    })
  })
})
