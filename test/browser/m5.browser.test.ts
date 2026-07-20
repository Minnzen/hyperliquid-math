import { describe, expect, it } from 'vitest'
import m5Fixture from '../fixtures/m5-results.json?raw'
import { m5Results } from '../helpers/m5-results.js'

describe('M5 Chromium serialization fixture', () => {
  it('matches the reviewed Node bytes', () => {
    expect(`${JSON.stringify(m5Results())}\n`).toBe(m5Fixture)
  })
})
