/**
 * Detected runtime platform.
 */
export type Platform = "workers" | "node" | "bun" | "deno" | "unknown";

/**
 * Detects the current runtime platform.
 */
export function detectPlatform(): Platform {
	const g = globalThis as unknown as Record<string, unknown>;
	// Workers: no process global, has global caches API
	if (typeof g.process === "undefined" && typeof g.caches !== "undefined") {
		return "workers";
	}
	// Bun
	if (typeof g.Bun !== "undefined") return "bun";
	// Deno
	if (typeof g.Deno !== "undefined") return "deno";
	// Node
	if (
		typeof g.process === "object" &&
		g.process !== null &&
		typeof (g.process as Record<string, unknown>).versions === "object"
	)
		return "node";
	return "unknown";
}

/**
 * Resolves raw environment from the platform.
 * On Workers, env is passed per-request — this function throws to enforce explicit passing.
 * On Node/Bun/Deno, it returns the global env object.
 */
export function resolveEnv(explicitEnv?: Record<string, unknown>): Record<string, unknown> {
	if (explicitEnv) return explicitEnv;

	const platform = detectPlatform();
	const g = globalThis as unknown as Record<string, unknown>;
	switch (platform) {
		case "node":
		case "bun":
			return (g.process as Record<string, unknown>).env as Record<string, unknown>;
		case "deno": {
			const deno = g.Deno as { env: { toObject: () => Record<string, unknown> } };
			return deno.env.toObject();
		}
		case "workers":
			throw new Error(
				"@workkit/env: On Cloudflare Workers, you must pass the env object explicitly. " +
					"It is available as the second argument to your fetch handler.",
			);
		default:
			return {};
	}
}
