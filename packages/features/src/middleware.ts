import type { MiddlewareHandler } from "hono";
import { createFlags } from "./client";
import type { FlagOptions } from "./types";

/**
 * Hono middleware that creates a feature flag client and attaches it to the request context.
 *
 * The client is available via `c.get("flags")` in downstream handlers.
 *
 * @example
 * ```ts
 * const app = new Hono();
 * app.use(featureFlags({ kv: env.FLAGS_KV }));
 *
 * app.get("/", async (c) => {
 *   const flags = c.get("flags");
 *   const enabled = await flags.isEnabled("new-ui", { userId: "user-123" });
 *   return c.json({ newUi: enabled });
 * });
 * ```
 */
export function featureFlags(options: { kv: KVNamespace } & FlagOptions): MiddlewareHandler {
	const { kv, ...flagOptions } = options;
	const client = createFlags(kv, flagOptions);

	return async (c, next) => {
		c.set("flags" as never, client as never);
		await next();
	};
}
