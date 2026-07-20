import { execFileSync } from 'node:child_process'
import { describe, it } from 'vitest'

describe('public function manifest', () => {
  it('matches the built runtime function exports', () => {
    execFileSync(process.execPath, ['scripts/check-public-functions.mjs'])
  })
})
