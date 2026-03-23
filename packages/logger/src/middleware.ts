import type { Context, MiddlewareHandler } from "hono";
import { runWithContext } from "./context";
import { buildContextLogger } from "./logger";
import type { Logger, LoggerMiddlewareOptions, RequestContext } from "./types";

/**
 * Hono middleware for structured request logging.
 *
 * Auto-attaches to every request, logs start and completion with timing,
 * and sets up AsyncLocalStorage context so `getLogger()` works in handlers.
 *
 * @example
 * ```ts
 * const app = new Hono()
 * app.use(logger({ exclude: ['/health'], fields: { service: 'api' } }))
 * ```
 */
export function logger(options?: LoggerMiddlewareOptions): MiddlewareHandler {
	const exclude = options?.exclude ?? [];
	const requestIdHeader = options?.requestId;
	const baseFields = options?.fields ?? {};
	const timing = options?.timing ?? true;
	const level = options?.level ?? "info";
	const redact = options?.redact;

	return async (c, next) => {
		const path = new URL(c.req.url).pathname;

		// Check exclusion
		if (isExcluded(path, exclude)) {
			await next();
			return;
		}

		// Generate or read requestId
		const requestId = requestIdHeader
			? (c.req.header(requestIdHeader) ?? generateId())
			: generateId();

		const ctx: RequestContext = {
			requestId,
			method: c.req.method,
			path,
			startTime: Date.now(),
			fields: { ...baseFields },
		};

		// Store logger on Hono context for getLogger()
		c.set("workkit:logger:context" as never, ctx);
		c.set("workkit:logger:level" as never, level);
		c.set("workkit:logger:redact" as never, redact);

		await runWithContext(ctx, async () => {
			const log = buildContextLogger(level, baseFields, redact);
			log.info("incoming request", { requestId, method: ctx.method, path });

			await next();

			if (timing) {
				const duration = Date.now() - ctx.startTime;
				log.info("request complete", {
					requestId,
					method: ctx.method,
					path,
					status: c.res.status,
					duration,
				});
			}
		});
	};
}

/**
 * Get a logger instance from a Hono context.
 *
 * If the `logger()` middleware is active, the returned logger includes
 * request context (requestId, method, path). Without middleware, returns
 * a plain logger.
 *
 * @example
 * ```ts
 * app.get('/users', (c) => {
 *   const log = getLogger(c)
 *   log.info('fetching users')
 *   return c.json(users)
 * })
 * ```
 */
export function getLogger(c: Context): Logger {
	const ctx = c.get("workkit:logger:context" as never) as RequestContext | undefined;
	const level = (c.get("workkit:logger:level" as never) as string) ?? "info";
	const redact = c.get("workkit:logger:redact" as never) as LoggerMiddlewareOptions["redact"];

	if (ctx) {
		return buildContextLogger(
			level as "debug" | "info" | "warn" | "error",
			{ requestId: ctx.requestId, method: ctx.method, path: ctx.path, ...ctx.fields },
			redact,
		);
	}

	// Fallback: plain logger without request context
	return buildContextLogger(level as "debug" | "info" | "warn" | "error", {}, redact);
}

function isExcluded(path: string, exclude: string[]): boolean {
	for (const pattern of exclude) {
		if (path === pattern || path.startsWith(pattern)) return true;
	}
	return false;
}

function generateId(): string {
	return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}
