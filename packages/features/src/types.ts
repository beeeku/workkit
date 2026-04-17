/**
 * A feature flag definition stored in KV.
 */
export interface FlagDefinition {
	key: string;
	enabled: boolean;
	description?: string;
	/** Percentage rollout 0-100, sticky per userId via deterministic hash. */
	percentage?: number;
	/** Variant name to weight mapping for A/B testing. */
	variants?: Record<string, number>;
	/** All rules must match (AND logic) for the flag to apply. */
	targeting?: TargetingRule[];
	/** userId to forced value/variant overrides. */
	overrides?: Record<string, boolean | string>;
}

/**
 * A single targeting rule that evaluates a context attribute.
 */
export interface TargetingRule {
	attribute: string;
	operator: "eq" | "neq" | "in" | "notIn" | "gt" | "lt" | "contains";
	values: (string | number)[];
}

/**
 * Context passed to flag evaluation, typically includes userId and custom attributes.
 */
export interface FlagContext {
	userId?: string;
	[key: string]: string | number | boolean | undefined;
}

/**
 * The feature flag client interface for reading and managing flags.
 */
export interface FlagClient {
	isEnabled(key: string, context?: FlagContext): Promise<boolean>;
	getVariant(key: string, context?: FlagContext): Promise<string | null>;
	getAllFlags(context?: FlagContext): Promise<Map<string, boolean>>;
	setFlag(key: string, definition: FlagDefinition): Promise<void>;
	deleteFlag(key: string): Promise<void>;
	listFlags(): Promise<FlagDefinition[]>;
}

/**
 * Options for configuring the feature flag client.
 */
export interface FlagOptions {
	/** KV key prefix, default "flags:" */
	prefix?: string;
	/** In-memory cache TTL in seconds, default 60 */
	cacheTtl?: number;
}
