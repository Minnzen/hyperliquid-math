import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const tempRoot = resolve('temp/pack-smoke')
const packageRoot = resolve('.')
await rm(tempRoot, { force: true, recursive: true })
await mkdir(resolve(tempRoot, 'node_modules'), { recursive: true })

const [{ filename, files }] = JSON.parse(
  execFileSync('npm', ['pack', packageRoot, '--json', '--ignore-scripts'], {
    cwd: tempRoot,
    encoding: 'utf8',
  }),
)
const archivePath = resolve(tempRoot, filename)
try {
  const expectedFiles = [
    'package/LICENSE',
    'package/README.md',
    'package/package.json',
    'package/spec/README.md',
    'package/spec/NUMERICS.md',
    'package/spec/WORKED-EXAMPLES.md',
    'package/spec/WORKED-EXAMPLES.json',
    'package/spec/KIT-MAPPING.md',
  ]
  const packedPaths = files.map(({ path }) => `package/${path}`)
  for (const expected of expectedFiles) {
    if (!packedPaths.includes(expected)) throw new Error(`Packed artifact misses ${expected}`)
  }
  execFileSync('tar', ['-xzf', archivePath, '-C', tempRoot])
  await symlink(resolve(tempRoot, 'package'), resolve(tempRoot, 'node_modules/hyperliquid-math'))
  await writeFile(
    resolve(tempRoot, 'smoke.mjs'),
    `import { calculateHip3FeeRates, calculateTradeFee, canonicalizeDecimalString, calculateBookMetrics, convertSpotTokenUnits, encodeAssetId, quantizePrice, validateHip1Deployment } from 'hyperliquid-math';\n` +
      `import { validateHip1Deployment as directHip1 } from 'hyperliquid-math/hip1';\n` +
      `import { calculateHip3FeeRates as directHip3FeeRates, calculateTradeFee as hip3TradeFee } from 'hyperliquid-math/hip3';\n` +
      `import { encodeAssetId as directId } from 'hyperliquid-math/identifiers';\n` +
      `import { calculateBookMetrics as directBook } from 'hyperliquid-math/orderbook';\n` +
      `import { canonicalizeDecimalString as direct, quantizePrice as directPrice } from 'hyperliquid-math/precision';\n` +
      `import { convertSpotTokenUnits as directSpotUnits } from 'hyperliquid-math/spot';\n` +
      `if (canonicalizeDecimalString !== direct) throw new Error('subpath mismatch');\n` +
      `if (quantizePrice !== directPrice || encodeAssetId !== directId || calculateBookMetrics !== directBook) throw new Error('M1 subpath mismatch');\n` +
      `if (validateHip1Deployment !== directHip1 || calculateHip3FeeRates !== directHip3FeeRates || calculateTradeFee !== hip3TradeFee || convertSpotTokenUnits !== directSpotUnits) throw new Error('M5 subpath mismatch');\n` +
      `const result = canonicalizeDecimalString({ value: '01.00' });\n` +
      `if (result.value.status !== 'ok' || result.value.data !== '1') throw new Error('bad result');\n`,
  )
  execFileSync(process.execPath, [resolve(tempRoot, 'smoke.mjs')], { stdio: 'inherit' })
  JSON.parse(await readFile(resolve(tempRoot, 'package/package.json'), 'utf8'))
} finally {
  await rm(archivePath, { force: true })
  await rm(tempRoot, { force: true, recursive: true })
}
