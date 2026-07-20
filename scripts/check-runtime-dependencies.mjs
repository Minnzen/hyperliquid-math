import { readFile } from 'node:fs/promises'

const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const expected = { 'decimal.js': '10.6.0' }
if (JSON.stringify(packageJson.dependencies) !== JSON.stringify(expected)) {
  throw new Error(`Runtime dependencies must be exactly ${JSON.stringify(expected)}`)
}
