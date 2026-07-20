import { describe, expect, it } from 'vitest'
import { canonicalizeDecimalString } from '../../src/index.js'
import fixture from '../fixtures/canonical-result.json?raw'
import m1Fixture from '../fixtures/m1-results.json?raw'
import m2Fixture from '../fixtures/m2-results.json?raw'
import m3Fixture from '../fixtures/m3-results.json?raw'
import m4Fixture from '../fixtures/m4-results.json?raw'
import { m1Results } from '../helpers/m1-results.js'
import { m2Results } from '../helpers/m2-results.js'
import { m3Results } from '../helpers/m3-results.js'
import { m4Results } from '../helpers/m4-results.js'

describe('Chromium serialization fixture', () => {
  it('matches the reviewed bytes', () => {
    expect(`${JSON.stringify(canonicalizeDecimalString({ value: '000123.45000' }))}\n`).toBe(
      fixture,
    )
  })
})

describe('M2 Chromium serialization fixture', () => {
  it('matches the reviewed Node bytes', () => {
    expect(`${JSON.stringify(m2Results())}\n`).toBe(m2Fixture)
  })
})

describe('M1 Chromium serialization fixture', () => {
  it('matches the reviewed Node bytes', () => {
    expect(`${JSON.stringify(m1Results())}\n`).toBe(m1Fixture)
  })
})

describe('M3 Chromium serialization fixture', () => {
  it('matches the reviewed Node bytes', () => {
    expect(`${JSON.stringify(m3Results())}\n`).toBe(m3Fixture)
  })
})

describe('M4 Chromium serialization fixture', () => {
  it('matches the reviewed Node bytes', () => {
    expect(`${JSON.stringify(m4Results())}\n`).toBe(m4Fixture)
  })
})
