import { access, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const manifest = JSON.parse(await readFile('spec/public-functions.json', 'utf8'))
const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const exportedFunctions = []
for (const [subpath, condition] of Object.entries(packageJson.exports)) {
  if (subpath === './package.json') continue
  const target = typeof condition === 'string' ? condition : condition.import
  const runtime = await import(pathToFileURL(`${process.cwd()}/${target}`).href)
  for (const [name, value] of Object.entries(runtime)) {
    if (typeof value === 'function') exportedFunctions.push(`${subpath}:${name}`)
  }
}
exportedFunctions.sort()
const manifestedFunctions = manifest.functions
  .flatMap(({ exportName, subpaths }) => subpaths.map((subpath) => `${subpath}:${exportName}`))
  .sort()

if (JSON.stringify(exportedFunctions) !== JSON.stringify(manifestedFunctions)) {
  throw new Error(
    `Public function mismatch: exports=${JSON.stringify(exportedFunctions)} manifest=${JSON.stringify(manifestedFunctions)}`,
  )
}

const allowedOracleStates = new Set(['full', 'partial', 'not-supported'])
for (const entry of manifest.functions) {
  await access(entry.specPath)
  if (new Set(entry.testKinds).size !== entry.testKinds.length || entry.testKinds.length === 0) {
    throw new Error(`${entry.exportName} must declare unique non-empty testKinds`)
  }
  for (const oracle of ['official-python-sdk', 'live-fixtures']) {
    if (!allowedOracleStates.has(entry.oracles[oracle])) {
      throw new Error(`${entry.exportName} has invalid ${oracle} oracle state`)
    }
  }
}
