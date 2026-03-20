import type { StandardSchemaV1 } from '@standard-schema/spec'

/**
 * A schema map where keys are env var names and values are Standard Schema validators.
 */
export type EnvSchema = Record<string, StandardSchemaV1>

/**
 * Infers the fully-typed output from a schema map.
 * Each key's type is derived from the StandardSchemaV1.InferOutput of its validator.
 */
export type InferEnv<T extends EnvSchema> = {
  [K in keyof T]: StandardSchemaV1.InferOutput<T[K]>
}

/**
 * Infers the input type (what raw values are expected before transformation).
 */
export type InferRawEnv<T extends EnvSchema> = {
  [K in keyof T]: StandardSchemaV1.InferInput<T[K]>
}
