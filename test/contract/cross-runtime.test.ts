import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { canonicalizeDecimalString } from '../../src/index.js'
import { m1Results } from '../helpers/m1-results.js'
import { m2Results } from '../helpers/m2-results.js'
import { m3Results } from '../helpers/m3-results.js'
import { m4Results } from '../helpers/m4-results.js'
import { m5Results } from '../helpers/m5-results.js'
import { m6Results } from '../helpers/m6-results.js'

describe('Node serialization fixture', () => {
  it('matches the reviewed bytes', async () => {
    const fixture = await readFile('test/fixtures/canonical-result.json', 'utf8')
    expect(`${JSON.stringify(canonicalizeDecimalString({ value: '000123.45000' }))}\n`).toBe(
      fixture,
    )
  })
})

describe('M1 Node serialization fixture', () => {
  it('matches the reviewed bytes', async () => {
    const fixture = await readFile('test/fixtures/m1-results.json', 'utf8')
    expect(`${JSON.stringify(m1Results())}\n`).toBe(fixture)
  })
})

describe('M2 Node serialization fixture', () => {
  it('matches the reviewed bytes', async () => {
    const fixture = await readFile('test/fixtures/m2-results.json', 'utf8')
    expect(`${JSON.stringify(m2Results())}\n`).toBe(fixture)
  })
})

describe('M3 Node serialization fixture', () => {
  it('matches the reviewed bytes', async () => {
    const fixture = await readFile('test/fixtures/m3-results.json', 'utf8')
    expect(`${JSON.stringify(m3Results())}\n`).toBe(fixture)
  })
})

describe('M4 Node serialization fixture', () => {
  it('matches the reviewed fixture', async () => {
    const fixture = await readFile('test/fixtures/m4-results.json', 'utf8')
    expect(`${JSON.stringify(m4Results())}\n`).toBe(fixture)
  })
})

describe('M5 Node serialization fixture', () => {
  it('matches the reviewed fixture', async () => {
    const fixture = await readFile('test/fixtures/m5-results.json', 'utf8')
    expect(`${JSON.stringify(m5Results())}\n`).toBe(fixture)
  })
})

describe('M6 Node serialization fixture', () => {
  it('matches the reviewed fixture', async () => {
    const fixture = await readFile('test/fixtures/m6-results.json', 'utf8')
    expect(`${JSON.stringify(m6Results())}\n`).toBe(fixture)
  })
})
