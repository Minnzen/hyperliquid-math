import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('repository guards', () => {
  it.each(['scripts/check-runtime-dependencies.mjs', 'scripts/check-import-boundaries.mjs'])(
    '%s exits successfully',
    (script) => {
      execFileSync(process.execPath, [script])
    },
  )

  it.each([
    ['a dynamic Node-only import', "export const load = () => import('node:fs')"],
    ['a dynamic Decimal kernel bypass', "export const load = () => import('decimal.js')"],
    ['a CommonJS Node-only import', "export const fs = require('node:fs')"],
    ['a CommonJS Decimal kernel bypass', "export const Decimal = require('decimal.js')"],
    ['a non-literal CommonJS import', 'export const load = (name: string) => require(name)'],
  ])('rejects %s', async (_label, source) => {
    const root = await mkdtemp(join(tmpdir(), 'hyperliquid-math-boundary-'))
    try {
      await writeFile(join(root, 'domain.ts'), source)
      const runGuard = () =>
        execFileSync(process.execPath, ['scripts/check-import-boundaries.mjs', root], {
          stdio: 'pipe',
        })

      expect(runGuard).toThrow()
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })
})
