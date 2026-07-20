import { readdir, readFile } from 'node:fs/promises'

for (const name of await readdir('.github/workflows')) {
  if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue
  const path = `.github/workflows/${name}`
  const lines = (await readFile(path, 'utf8')).split('\n')
  for (const [index, line] of lines.entries()) {
    const match = /uses:\s*([^\s#]+)/.exec(line)
    if (!match || match[1].startsWith('./')) continue
    if (!/^[^/\s]+\/[^@\s]+@[0-9a-f]{40}$/.test(match[1]) || !/#\s*v\d/.test(line)) {
      throw new Error(`${path}:${index + 1} must pin a full action SHA with a version comment`)
    }
  }
}
