import { execFileSync } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const tempRoot = resolve('temp/pack-smoke')
const packageRoot = resolve('.')
const scriptRoot = dirname(fileURLToPath(import.meta.url))

await rm(tempRoot, { force: true, recursive: true })
await mkdir(tempRoot, { recursive: true })
try {
  const [{ filename }] = JSON.parse(
    execFileSync('npm', ['pack', packageRoot, '--json', '--ignore-scripts'], {
      cwd: tempRoot,
      encoding: 'utf8',
    }),
  )
  const archivePath = resolve(tempRoot, filename)
  execFileSync(process.execPath, [resolve(scriptRoot, 'verify-package-tarball.mjs'), archivePath], {
    stdio: 'inherit',
  })
} finally {
  await rm(tempRoot, { force: true, recursive: true })
}
