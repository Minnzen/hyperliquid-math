import { rm } from 'node:fs/promises'

await Promise.all([
  rm('dist', { force: true, recursive: true }),
  rm('coverage', { force: true, recursive: true }),
  rm('temp', { force: true, recursive: true }),
])
