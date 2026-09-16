#!/usr/bin/env node
// Verifies that every official documentation page pinned by a Markdown SHA-256 in spec/SOURCES.md
// still hashes to its recorded pin. GitBook serves a raw Markdown rendering of every page at the
// page URL plus a `.md` suffix; the pin is the SHA-256 of those response bytes.
//
// This check needs the network, so it is deliberately excluded from `pnpm check` and runs only from
// the weekly upstream sentinel workflow (or manually via `pnpm docs:check`).
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const REQUEST_TIMEOUT_MS = 20_000
const REQUEST_SPACING_MS = 250
const PIN_PATTERN = /(parent\s+)?Markdown\s+SHA-256[\s:`]*([0-9a-f]{64})/i
const BACKTICKED = /`([^`]+)`/

const sourcesPath = process.argv[2] ?? fileURLToPath(new URL('../spec/SOURCES.md', import.meta.url))

function splitRow(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return undefined
  const cells = trimmed.split('|')
  cells.shift()
  if (trimmed.endsWith('|')) cells.pop()
  return cells.map((cell) => cell.trim())
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

// Column order is read from the header rather than assumed, so rows added by other work keep
// parsing as long as the header keeps naming the same columns.
function readColumns(cells) {
  const columns = {}
  for (const [index, cell] of cells.entries()) {
    const name = cell.toLowerCase()
    if (name === 'source id') columns.id = index
    else if (name === 'location') columns.location = index
    else if (name === 'last verified') columns.verified = index
    else if (name === 'integrity') columns.integrity = index
  }
  return columns.id !== undefined &&
    columns.location !== undefined &&
    columns.verified !== undefined &&
    columns.integrity !== undefined
    ? columns
    : undefined
}

function unwrap(cell) {
  return BACKTICKED.exec(cell)?.[1] ?? cell
}

// The recorded hash is always the hash of a whole page. A row citing a section (`#fragment`) pins
// the page that contains it, and a row whose Integrity says "parent Markdown SHA-256" pins that
// page's parent: the fragment-stripped URL when the row cites a section, otherwise the URL with its
// final path segment removed.
function resolvePageUrl(rawUrl, isParentPin) {
  const url = new URL(rawUrl)
  const hadFragment = url.hash !== ''
  url.hash = ''
  if (isParentPin && !hadFragment) {
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length < 2) {
      throw new Error(`cannot resolve a parent page for ${rawUrl}`)
    }
    segments.pop()
    url.pathname = `/${segments.join('/')}`
  }
  return url.toString()
}

function parsePinnedPages(markdown) {
  const pages = new Map()
  const problems = []
  let columns

  for (const line of markdown.split('\n')) {
    const cells = splitRow(line)
    if (!cells) continue
    if (!columns) {
      columns = readColumns(cells)
      continue
    }
    if (isSeparatorRow(cells)) continue
    if (cells.length <= columns.integrity) continue

    const pin = PIN_PATTERN.exec(cells[columns.integrity])
    if (!pin) continue

    const id = unwrap(cells[columns.id])
    const location = unwrap(cells[columns.location])
    if (!/^https?:\/\//.test(location)) {
      problems.push(`${id} records a Markdown SHA-256 for a non-HTTP location ${location}`)
      continue
    }

    let pageUrl
    try {
      pageUrl = resolvePageUrl(location, Boolean(pin[1]))
    } catch (error) {
      problems.push(`${id}: ${error.message}`)
      continue
    }

    const page = pages.get(pageUrl) ?? { url: pageUrl, pins: [] }
    page.pins.push({ id, hash: pin[2], verified: cells[columns.verified] })
    pages.set(pageUrl, page)
  }

  if (!columns) problems.push('no source table header was found')
  return { pages: [...pages.values()], problems }
}

// Several source IDs legitimately pin the same page. When they were verified on different dates the
// older rows are superseded historical snapshots, so only the newest pin describes upstream today.
function currentPin(pins) {
  const newest = pins.reduce((a, b) => (b.verified > a.verified ? b : a))
  const current = pins.filter((pin) => pin.verified === newest.verified)
  const superseded = pins.filter((pin) => pin.verified !== newest.verified)
  const hashes = new Set(current.map((pin) => pin.hash))
  return { current, superseded, hashes }
}

async function fetchPageHash(pageUrl) {
  let response
  try {
    response = await fetch(`${pageUrl}.md`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (error) {
    return { error: `request failed: ${error.message}` }
  }
  if (!response.ok) {
    return { error: `HTTP ${response.status} ${response.statusText}`.trim() }
  }
  let bytes
  try {
    bytes = Buffer.from(await response.arrayBuffer())
  } catch (error) {
    return { error: `response body failed: ${error.message}` }
  }
  return { hash: createHash('sha256').update(bytes).digest('hex') }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const { pages, problems } = parsePinnedPages(await readFile(sourcesPath, 'utf8'))
pages.sort((a, b) => a.url.localeCompare(b.url))

for (const problem of problems) {
  console.log(`PARSE  ${problem}`)
}
console.log(`Checking ${pages.length} pinned documentation page(s) from ${sourcesPath}\n`)

let drifted = 0
let unreachable = 0
let inconsistent = 0

for (const [index, page] of pages.entries()) {
  const { current, superseded, hashes } = currentPin(page.pins)
  const ids = current.map((pin) => pin.id).join(', ')
  const verified = current[0].verified

  if (hashes.size > 1) {
    inconsistent += 1
    console.log(`AMBIG  ${page.url}`)
    console.log(`       ${ids} pin different hashes on the same date ${verified}`)
    continue
  }

  if (index > 0) await sleep(REQUEST_SPACING_MS)
  const result = await fetchPageHash(page.url)
  const expected = current[0].hash

  if (result.error) {
    unreachable += 1
    console.log(`ERROR  ${page.url}`)
    console.log(`       ${result.error}`)
  } else if (result.hash === expected) {
    console.log(`MATCH  ${page.url}`)
    console.log(`       ${expected}  ${ids} (${verified})`)
  } else {
    drifted += 1
    console.log(`DRIFT  ${page.url}`)
    console.log(`       pinned ${expected}  ${ids} (${verified})`)
    console.log(`       actual ${result.hash}`)
  }

  for (const pin of superseded) {
    console.log(`       superseded pin ${pin.hash}  ${pin.id} (${pin.verified})`)
  }
}

const matched = pages.length - drifted - unreachable - inconsistent
console.log(
  `\n${pages.length} page(s) checked: ${matched} match, ${drifted} drift, ` +
    `${unreachable} unreachable, ${inconsistent} ambiguous, ${problems.length} unparsed row(s)`,
)

if (
  drifted > 0 ||
  unreachable > 0 ||
  inconsistent > 0 ||
  problems.length > 0 ||
  pages.length === 0
) {
  process.exitCode = 1
}
