import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('capability registry', () => {
  it('is checked from public repository data only', async () => {
    execFileSync(process.execPath, ['scripts/generate-capabilities.mjs', '--check'])
    const registry = JSON.parse(await readFile('spec/capabilities.json', 'utf8')) as {
      schemaVersion: number
      registryKind: string
      implementationStatus: string
      deliveryEvidence: string
      source: string
      capabilities: Array<{
        id: string
        intendedCoverage: string
        authority: string
        maturity: string
      }>
    }

    expect(registry).toMatchObject({
      schemaVersion: 2,
      registryKind: 'architecture-scope',
      implementationStatus: 'not-asserted',
      deliveryEvidence: 'spec/public-functions.json',
      source: 'public-capability-registry',
    })
    expect(registry.capabilities).toHaveLength(111)
    expect(new Set(registry.capabilities.map((item) => item.id)).size).toBe(111)
    for (const item of registry.capabilities) {
      expect(['full', 'partial', 'none']).toContain(item.intendedCoverage)
      if (item.intendedCoverage === 'none') {
        expect(item.authority).toBe('n/a')
        expect(item.maturity).toBe('n/a')
      } else {
        expect(item.authority).not.toBe('n/a')
        expect(item.maturity).not.toBe('n/a')
      }
    }
  })
})
