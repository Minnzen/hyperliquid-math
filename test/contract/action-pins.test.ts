import { execFileSync } from 'node:child_process'
import { describe, it } from 'vitest'

describe('GitHub Actions supply-chain pins', () => {
  it('uses full reviewed SHAs', () => {
    execFileSync(process.execPath, ['scripts/check-action-pins.mjs'])
  })
})
