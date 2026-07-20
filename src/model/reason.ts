import type { JsonObject } from './json.js'

/**
 * Machine-readable reason for a non-`ok` outcome; `path` is an RFC 6901 JSON Pointer into the
 * input.
 *
 * @public
 */
export interface MathReason {
  readonly code: string
  readonly path?: string
  readonly details?: JsonObject
  readonly sourceRefs?: readonly string[]
}

/**
 * One `invalid-input` finding: what was found (`actual`) vs required (`expected`) at the JSON
 * Pointer `path`.
 *
 * @public
 */
export interface MathIssue {
  readonly code: string
  readonly path?: string
  readonly actual?: string
  readonly expected?: string
}
