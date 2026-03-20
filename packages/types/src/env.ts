import type { StandardSchemaV1 } from '@standard-schema/spec'

// --- Env definition types ---

/** A binding definition — either a Standard Schema validator or a binding type checker */
export type BindingDef = StandardSchemaV1 | BindingTypeCheck

/** Binding type check for CF-specific bindings (KV, D1, R2, etc.) */
export interface BindingTypeCheck {
	readonly __bindingType: string
	readonly validate: (value: unknown) => boolean
}

/** An env schema — mapping of binding names to their definitions */
export type EnvSchema = Record<string, BindingDef>

/** Infer the parsed env type from a schema definition */
export type InferEnv<S extends EnvSchema> = {
	[K in keyof S]: S[K] extends StandardSchemaV1<any, infer O>
		? O
		: S[K] extends BindingTypeCheck
			? InferBindingType<S[K]>
			: unknown
}

/** Map binding type check to its runtime type */
export type InferBindingType<B extends BindingTypeCheck> =
	B['__bindingType'] extends 'KVNamespace'
		? KVNamespace
		: B['__bindingType'] extends 'D1Database'
			? D1Database
			: B['__bindingType'] extends 'R2Bucket'
				? R2Bucket
				: B['__bindingType'] extends 'DurableObjectNamespace'
					? DurableObjectNamespace
					: B['__bindingType'] extends 'Queue'
						? Queue
						: B['__bindingType'] extends 'Fetcher'
							? Fetcher
							: B['__bindingType'] extends 'AnalyticsEngineDataset'
								? AnalyticsEngineDataset
								: unknown

// --- Env parse result ---

export interface EnvParseSuccess<T> {
	readonly success: true
	readonly env: T
}

export interface EnvParseFailure {
	readonly success: false
	readonly errors: EnvValidationError[]
}

export interface EnvValidationError {
	readonly binding: string
	readonly message: string
	readonly expected: string
	readonly received: string
}

export type EnvParseResult<T> = EnvParseSuccess<T> | EnvParseFailure
