/** @public */
export type JsonPrimitive = null | boolean | string | number

/** @public */
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** @public */
export type JsonObject = Readonly<Record<string, JsonValue>>
