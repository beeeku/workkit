export interface FeatureOption {
	value: string;
	label: string;
	hint: string;
}

export const FEATURE_OPTIONS: FeatureOption[] = [
	{ value: "env", label: "@workkit/env", hint: "Type-safe environment validation" },
	{ value: "kv", label: "@workkit/kv", hint: "Typed KV with serialization" },
	{ value: "d1", label: "@workkit/d1", hint: "Typed D1 with query builder" },
	{ value: "r2", label: "@workkit/r2", hint: "R2 storage with streaming" },
	{ value: "cache", label: "@workkit/cache", hint: "SWR and cache patterns" },
	{ value: "queue", label: "@workkit/queue", hint: "Typed queue producer/consumer" },
	{ value: "cron", label: "@workkit/cron", hint: "Declarative cron handlers" },
	{ value: "auth", label: "@workkit/auth", hint: "JWT and session management" },
	{ value: "ratelimit", label: "@workkit/ratelimit", hint: "KV-backed rate limiting" },
	{ value: "ai", label: "@workkit/ai", hint: "Workers AI with streaming and fallback" },
	{
		value: "ai-gateway",
		label: "@workkit/ai-gateway",
		hint: "Multi-provider AI routing and caching",
	},
	{ value: "api", label: "@workkit/api", hint: "Type-safe API with OpenAPI generation" },
	{ value: "crypto", label: "@workkit/crypto", hint: "Encryption, hashing, and key derivation" },
	{ value: "do", label: "@workkit/do", hint: "Durable Object storage and state machines" },
	{ value: "logger", label: "@workkit/logger", hint: "Structured logging with request context" },
];
