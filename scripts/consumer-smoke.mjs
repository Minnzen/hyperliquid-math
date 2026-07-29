#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const requestedSpec = process.argv[2]
if (!requestedSpec) {
  throw new Error('usage: node scripts/consumer-smoke.mjs <package-spec-or-tarball>')
}

const packageSpec = existsSync(requestedSpec) ? resolve(requestedSpec) : requestedSpec
const tempRoot = await mkdtemp(join(tmpdir(), 'hyperliquid-math-consumer-'))
const scriptRoot = dirname(fileURLToPath(import.meta.url))
const expectedPackage = JSON.parse(await readFile(resolve(scriptRoot, '../package.json'), 'utf8'))

const subpaths = [
  'fees',
  'funding',
  'hip1',
  'hip3',
  'identifiers',
  'liquidation',
  'margin',
  'model',
  'orderbook',
  'orders',
  'positions',
  'precision',
  'reconciliation',
  'scenarios',
  'spot',
]

try {
  await writeFile(
    join(tempRoot, 'package.json'),
    `${JSON.stringify({ name: 'hyperliquid-math-consumer-smoke', private: true, type: 'module' }, null, 2)}\n`,
  )
  await writeFile(
    join(tempRoot, 'runtime.mjs'),
    `import { calculateTradeFee, canonicalizeDecimalString, encodeAssetId, quantizePrice } from 'hyperliquid-math'\n` +
      `const subpaths = ${JSON.stringify(subpaths)}\n` +
      `for (const subpath of subpaths) {\n` +
      `  const module = await import(\`hyperliquid-math/\${subpath}\`)\n` +
      `  if (subpath !== 'model' && Object.keys(module).length === 0) throw new Error(\`empty subpath: \${subpath}\`)\n` +
      `}\n` +
      `const canonical = canonicalizeDecimalString({ value: '01.00' })\n` +
      `if (canonical.value.status !== 'ok' || canonical.value.data !== '1') throw new Error('canonicalization mismatch')\n` +
      `const price = quantizePrice({ value: '12345.67891', marketKind: 'perp', szDecimals: 2, rounding: 'down' })\n` +
      `if (price.value.status !== 'ok' || price.value.data.value !== '12345') throw new Error('price quantization mismatch')\n` +
      `const assetId = encodeAssetId({ kind: 'hip3-perp', dexIndex: 1, index: 7 })\n` +
      `if (assetId.value.status !== 'ok' || assetId.value.data !== 110007) throw new Error('asset ID mismatch')\n` +
      `const fee = calculateTradeFee({ price: '100', size: '2', rate: '0.001' })\n` +
      `if (fee.value.status !== 'ok' || fee.value.data.feeAmount !== '0.2') throw new Error('fee mismatch')\n`,
  )
  await writeFile(
    join(tempRoot, 'types.ts'),
    `import { calculateTradeFee, canonicalizeDecimalString } from 'hyperliquid-math'\n` +
      `import { encodeAssetId } from 'hyperliquid-math/identifiers'\n` +
      `import { quantizePrice } from 'hyperliquid-math/precision'\n` +
      `const canonical = canonicalizeDecimalString({ value: '01.00' })\n` +
      `const price = quantizePrice({ value: '12345.67891', marketKind: 'perp', szDecimals: 2, rounding: 'down' })\n` +
      `const assetId = encodeAssetId({ kind: 'hip3-perp', dexIndex: 1, index: 7 })\n` +
      `const fee = calculateTradeFee({ price: '100', size: '2', rate: '0.001' })\n` +
      `if (canonical.value.status === 'ok') {\n` +
      `  const value: string = canonical.value.data\n` +
      `  void value\n` +
      `}\n` +
      `if (price.value.status === 'ok') {\n` +
      `  const value: string = price.value.data.value\n` +
      `  void value\n` +
      `}\n` +
      `if (assetId.value.status === 'ok') {\n` +
      `  const value: number = assetId.value.data\n` +
      `  void value\n` +
      `}\n` +
      `if (fee.value.status === 'ok') {\n` +
      `  const value: string = fee.value.data.feeAmount\n` +
      `  void value\n` +
      `}\n`,
  )
  await writeFile(
    join(tempRoot, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          noEmit: true,
          skipLibCheck: false,
          strict: true,
          target: 'ES2023',
        },
        include: ['types.ts'],
      },
      null,
      2,
    )}\n`,
  )

  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--save-dev',
      '--save-exact',
      '--registry=https://registry.npmjs.org/',
      'typescript@5.9.3',
      '@types/node@24.13.3',
      packageSpec,
    ],
    {
      cwd: tempRoot,
      stdio: 'inherit',
    },
  )

  const installedPackage = JSON.parse(
    await readFile(join(tempRoot, 'node_modules/hyperliquid-math/package.json'), 'utf8'),
  )
  if (
    installedPackage.name !== expectedPackage.name ||
    installedPackage.version !== expectedPackage.version
  ) {
    throw new Error('consumer installed an unexpected package identity')
  }

  execFileSync(process.execPath, [join(tempRoot, 'runtime.mjs')], { stdio: 'inherit' })
  execFileSync(
    process.execPath,
    [
      join(tempRoot, 'node_modules/typescript/bin/tsc'),
      '--project',
      join(tempRoot, 'tsconfig.json'),
    ],
    {
      stdio: 'inherit',
    },
  )
  console.log(`consumer smoke passed for hyperliquid-math@${installedPackage.version}`)
} finally {
  await rm(tempRoot, { force: true, recursive: true })
}
