// Client
export { createFlags } from "./client";

// Evaluation
export { evaluateFlag, evaluateVariant, matchesRule } from "./evaluate";

// Hash
export { deterministicHash } from "./hash";

// Middleware
export { featureFlags } from "./middleware";

// Types
export type {
	FlagClient,
	FlagContext,
	FlagDefinition,
	FlagOptions,
	TargetingRule,
} from "./types";
