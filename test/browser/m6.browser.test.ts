import { describe, expect, it } from 'vitest'
import m6Fixture from '../fixtures/m6-results.json?raw'
import { m6Results } from '../helpers/m6-results.js'

describe('M6 Chromium serialization fixture', () => {
  it('matches the reviewed Node bytes', () => {
    expect(`${JSON.stringify(m6Results())}\n`).toBe(m6Fixture)
  })
})
