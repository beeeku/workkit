import type { MiddlewareHandler } from "hono";
import type { TurnstileMiddlewareOptions, TurnstileResult } from "./types";
import { verifyTurnstile } from "./verify";

/**
 * Hono middleware for Cloudflare Turnstile verification.
 *
 * Extracts the Turnstile token from a request header or JSON body field,
 * verifies it against the Cloudflare siteverify endpoint, and either
 * continues the request or returns a 403 response.
 *
 * On success, the verification result is available via `c.get("turnstile")`.
 *
 * @example
 * ```ts
 * const app = new Hono()
 * app.use("/api/*", turnstile({ secretKey: env.TURNSTILE_SECRET }))
 * app.post("/api/submit", (c) => {
 *   const result = c.get("turnstile")
 *   return c.json({ verified: result.success })
 * })
 * ```
 */
export function turnstile(options: TurnstileMiddlewareOptions): MiddlewareHandler {
	const headerName = options.headerName ?? "cf-turnstile-response";
	const fieldName = options.fieldName ?? "cf-turnstile-response";
	const remoteIpHeader = options.remoteIpHeader ?? "cf-connecting-ip";

	return async (c, next) => {
		let token: string | undefined;

		// Try header first
		token = c.req.header(headerName);

		// Fall back to JSON body
		if (!token) {
			try {
				const contentType = c.req.header("content-type") ?? "";
				if (contentType.includes("application/json")) {
					const body = await c.req.json();
					token = body?.[fieldName];
				}
			} catch {
				// Body parsing failed, token stays undefined
			}
		}

		if (!token) {
			return c.json(
				{ error: "Turnstile verification failed", codes: ["missing-input-response"] },
				403,
			);
		}

		const remoteIp = c.req.header(remoteIpHeader);

		const result: TurnstileResult = await verifyTurnstile(token, options.secretKey, {
			remoteIp: remoteIp ?? undefined,
			expectedAction: options.expectedAction,
			timeout: options.timeout,
		});

		if (!result.success) {
			return c.json(
				{ error: "Turnstile verification failed", codes: result.errorCodes },
				403,
			);
		}

		c.set("turnstile" as never, result);
		await next();
	};
}
