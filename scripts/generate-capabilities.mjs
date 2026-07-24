#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'

const outputPath = 'spec/capabilities.json'
const expectedSource = 'public-capability-registry'
const allowedCoverage = new Set(['full', 'partial', 'none'])
const requiredRegistryFields = {
  schemaVersion: 2,
  registryKind: 'architecture-scope',
  implementationStatus: 'not-asserted',
  deliveryEvidence: 'spec/public-functions.json',
  source: expectedSource,
}

const readRegistry = async () => JSON.parse(await readFile(outputPath, 'utf8'))

const assertString = (value, name) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
}

const normalizeCapability = (item, index) => {
  const path = `capabilities[${index}]`
  assertString(item.id, `${path}.id`)
  assertString(item.section, `${path}.section`)
  assertString(item.capability, `${path}.capability`)
  assertString(item.intendedCoverage, `${path}.intendedCoverage`)
  assertString(item.authority, `${path}.authority`)
  assertString(item.maturity, `${path}.maturity`)
  assertString(item.notes, `${path}.notes`)
  if (!allowedCoverage.has(item.intendedCoverage)) {
    throw new Error(`${path}.intendedCoverage must be full, partial, or none`)
  }
  if (item.intendedCoverage === 'none') {
    if (item.authority !== 'n/a' || item.maturity !== 'n/a') {
      throw new Error(`${path} with no coverage must use n/a authority and maturity`)
    }
  } else if (item.authority === 'n/a' || item.maturity === 'n/a') {
    throw new Error(`${path} with coverage must declare authority and maturity`)
  }
  return {
    id: item.id,
    section: item.section,
    capability: item.capability,
    intendedCoverage: item.intendedCoverage,
    authority: item.authority,
    maturity: item.maturity,
    ...(typeof item.owner === 'string' ? { owner: item.owner } : {}),
    notes: item.notes,
  }
}

const normalizeRegistry = (registry) => {
  for (const [key, value] of Object.entries(requiredRegistryFields)) {
    if (registry[key] !== value) {
      throw new Error(`${key} must be ${JSON.stringify(value)}`)
    }
  }
  if (!Array.isArray(registry.capabilities)) {
    throw new Error('capabilities must be an array')
  }
  if (registry.capabilities.length !== 111) {
    throw new Error(`Expected 111 capability rows, found ${registry.capabilities.length}`)
  }

  const capabilities = registry.capabilities.map(normalizeCapability)
  const ids = new Set(capabilities.map((item) => item.id))
  if (ids.size !== capabilities.length) {
    throw new Error('capability ids must be unique')
  }

  return {
    ...requiredRegistryFields,
    capabilities,
  }
}

const generated = `${JSON.stringify(normalizeRegistry(await readRegistry()), null, 2)}\n`

if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8')
  if (current !== generated) {
    throw new Error('spec/capabilities.json is stale; run pnpm capabilities:generate')
  }
} else {
  await writeFile(outputPath, generated)
}
