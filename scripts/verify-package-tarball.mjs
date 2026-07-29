#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const requestedArchive = process.argv[2]
if (!requestedArchive) {
  throw new Error('usage: node scripts/verify-package-tarball.mjs <package.tgz>')
}

const archivePath = resolve(requestedArchive)
await stat(archivePath)

const tempRoot = await mkdtemp(join(tmpdir(), 'hyperliquid-math-tarball-'))
const scriptRoot = dirname(fileURLToPath(import.meta.url))
const requiredRootFiles = [
  'package/LICENSE',
  'package/README.md',
  'package/README.zh-CN.md',
  'package/SKILL.md',
  'package/package.json',
]

try {
  const entries = execFileSync('tar', ['-tzf', archivePath], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
  for (const required of requiredRootFiles) {
    if (!entries.includes(required)) throw new Error(`packed artifact misses ${required}`)
  }
  if (!entries.some((entry) => entry === 'package/spec/README.md')) {
    throw new Error('packed artifact misses the formula manual')
  }
  if (!entries.some((entry) => entry === 'package/dist/index.js')) {
    throw new Error('packed artifact misses the root ESM entry')
  }
  for (const entry of entries) {
    const allowed =
      requiredRootFiles.includes(entry) ||
      entry.startsWith('package/dist/') ||
      entry.startsWith('package/spec/')
    if (!allowed) throw new Error(`unexpected packed file: ${entry}`)
  }

  execFileSync('tar', ['-xzf', archivePath, '-C', tempRoot])
  const packageRoot = join(tempRoot, 'package')
  const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
  if (packageJson.name !== 'hyperliquid-math' || packageJson.version === '0.0.0') {
    throw new Error('packed artifact has an unexpected package identity')
  }
  if (
    packageJson.publishConfig?.access !== 'public' ||
    packageJson.publishConfig?.registry !== 'https://registry.npmjs.org/'
  ) {
    throw new Error('packed artifact does not pin public npm publishing')
  }
  if (
    packageJson.dependencies?.['decimal.js'] !== '10.6.0' ||
    Object.keys(packageJson.dependencies).length !== 1
  ) {
    throw new Error('packed artifact has unexpected runtime dependencies')
  }

  for (const [subpath, target] of Object.entries(packageJson.exports)) {
    if (subpath === './package.json') continue
    for (const condition of ['types', 'import']) {
      const relativeTarget = target[condition]
      if (typeof relativeTarget !== 'string') {
        throw new Error(`export ${subpath} misses ${condition}`)
      }
      await stat(join(packageRoot, relativeTarget))
    }
  }

  execFileSync(process.execPath, [join(scriptRoot, 'consumer-smoke.mjs'), archivePath], {
    stdio: 'inherit',
  })
  console.log(`tarball contents verified for hyperliquid-math@${packageJson.version}`)
} finally {
  await rm(tempRoot, { force: true, recursive: true })
}
