import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('toolchain contract', () => {
  it('pins the package manager and the only runtime dependency', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      packageManager: string
      dependencies: Record<string, string>
      type: string
    }

    expect(packageJson.packageManager).toBe('pnpm@11.15.0')
    expect(packageJson.type).toBe('module')
    expect(packageJson.dependencies).toEqual({ 'decimal.js': '10.6.0' })
  })
})
