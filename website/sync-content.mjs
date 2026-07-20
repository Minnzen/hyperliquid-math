// Build-time content sync for the hyperliquid-math documentation site.
//
// spec/ and SKILL.md are the single source of truth for the reference manual and
// the AI-agent guide. This script copies them into the VitePress content tree and
// applies the minimum transform needed for in-site rendering:
//   1. backfill an H1 for any file that lacks one (defensive; every source has one today)
//   2. rewrite relative links between source docs to their in-site destinations
//   3. serve the machine-readable worked-examples vector as a static asset
//
// Reference/spec pages are not translated: the English original is mirrored into
// both the root (English) and the /zh/ tree, and the zh sidebar labels them
// "(English)". Nothing here is hand-copied — the site is always regenerated from
// the source of truth, and every generated file is git-ignored.

import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const websiteDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(websiteDir, '..')
const specDir = resolve(repoRoot, 'spec')

// Source basename -> site path relative to a locale root (no locale prefix).
const ROUTES = {
  'README.md': 'reference/index.md',
  'precision.md': 'reference/precision.md',
  'identifiers.md': 'reference/identifiers.md',
  'orderbook.md': 'reference/orderbook.md',
  'fees.md': 'reference/fees.md',
  'positions.md': 'reference/positions.md',
  'funding.md': 'reference/funding.md',
  'margin.md': 'reference/margin.md',
  'liquidation.md': 'reference/liquidation.md',
  'scenarios.md': 'reference/scenarios.md',
  'orders.md': 'reference/orders.md',
  'reconciliation.md': 'reference/reconciliation.md',
  'spot.md': 'reference/spot.md',
  'hip1.md': 'reference/hip1.md',
  'hip3.md': 'reference/hip3.md',
  'NUMERICS.md': 'reference/numerics.md',
  'WORKED-EXAMPLES.md': 'reference/worked-examples.md',
  'oracles.md': 'reference/oracles.md',
  'SOURCES.md': 'reference/sources.md',
  'KIT-MAPPING.md': 'guide/field-mapping.md',
  'SKILL.md': 'guide/for-ai-agents.md',
}

// Non-page asset links, rewritten to a served public path (VitePress prepends base).
const ASSET_LINKS = {
  'WORKED-EXAMPLES.json': '/worked-examples.json',
}

// Most sources live in spec/; SKILL.md lives at the repository root.
const SOURCES = Object.keys(ROUTES).map((name) => ({
  name,
  abs: name === 'SKILL.md' ? resolve(repoRoot, 'SKILL.md') : resolve(specDir, name),
  site: ROUTES[name],
}))

// '' = root locale (English); 'zh' = the mirrored English copy under /zh/.
const LOCALES = ['', 'zh']

function splitFrontMatter(text) {
  if (!text.startsWith('---\n')) return { front: '', body: text }
  const end = text.indexOf('\n---', 4)
  if (end === -1) return { front: '', body: text }
  const close = text.indexOf('\n', end + 1)
  const cut = close === -1 ? text.length : close + 1
  return { front: text.slice(0, cut), body: text.slice(cut) }
}

function titleFromSite(site) {
  const base = site.split('/').pop().replace(/\.md$/, '')
  const name = base === 'index' ? 'reference' : base
  return name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function toPosix(p) {
  return p.split('\\').join('/')
}

function rewriteLinks(body, site) {
  return body.replace(/\]\(([^)]+)\)/g, (whole, target) => {
    const match = /^([^#?]+)([#?].*)?$/.exec(target)
    if (!match) return whole
    const path = match[1]
    const suffix = match[2] || ''
    if (ASSET_LINKS[path]) return `](${ASSET_LINKS[path]}${suffix})`
    const dest = ROUTES[path]
    if (!dest) return whole
    let rel = toPosix(relative(dirname(site), dest))
    if (!rel.startsWith('.')) rel = `./${rel}`
    return `](${rel}${suffix})`
  })
}

function transform(text, site) {
  const { front, body } = splitFrontMatter(text)
  let out = body
  if (!/^#\s+/m.test(out)) out = `# ${titleFromSite(site)}\n\n${out}`
  out = rewriteLinks(out, site)
  return front + out
}

async function main() {
  // Serve the machine-readable worked-examples vector as a static asset.
  await mkdir(resolve(websiteDir, 'public'), { recursive: true })
  await cp(
    resolve(specDir, 'WORKED-EXAMPLES.json'),
    resolve(websiteDir, 'public', 'worked-examples.json'),
  )

  let pages = 0
  for (const src of SOURCES) {
    const rendered = transform(await readFile(src.abs, 'utf8'), src.site)
    for (const locale of LOCALES) {
      const outPath = resolve(websiteDir, locale, src.site)
      await mkdir(dirname(outPath), { recursive: true })
      await writeFile(outPath, rendered)
      pages += 1
    }
  }
  console.log(`sync-content: wrote ${pages} pages + 1 asset from spec/ + SKILL.md`)
}

await main()
