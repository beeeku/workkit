import type { Hono } from "hono";
import { createHealthCheck } from "./health";
import type { HealthHandlerOptions, ProbeConfig } from "./types";

/**
 * Registers a health-check endpoint on the given Hono app.
 *
 * Returns HTTP 200 for healthy/degraded and 503 for unhealthy.
 * Always sets `Cache-Control: no-store`.
 */
export function healthHandler(probes: ProbeConfig[], options?: HealthHandlerOptions) {
	const path = options?.path ?? "/health";
	const hc = createHealthCheck(probes, options);

	return (app: Hono<any>): void => {
		app.get(path, async (c) => {
			const result = await hc.check();
			const status = result.status === "unhealthy" ? 503 : 200;
			c.header("Cache-Control", "no-store");
			return c.json(result, status);
		});
	};
}
