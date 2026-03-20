import type { CFContext, CloudflareLoadContext } from "./types";

/**
 * Extracts Cloudflare-specific context from Remix's loader/action context.
 *
 * Provides typed access to waitUntil, passThroughOnException, and cf properties
 * (country, colo, etc.) from the Cloudflare execution context.
 *
 * @example
 * ```ts
 * import { getCFContext } from '@workkit/remix'
 *
 * export const loader = async ({ context }: LoaderFunctionArgs) => {
 *   const { waitUntil, cf } = getCFContext(context)
 *   waitUntil(logAnalytics())
 *   return { country: cf?.country }
 * }
 * ```
 */
export function getCFContext(context: CloudflareLoadContext): CFContext {
	const { ctx, cf } = context.cloudflare;

	return {
		waitUntil: ctx.waitUntil.bind(ctx),
		passThroughOnException: ctx.passThroughOnException.bind(ctx),
		cf,
	};
}
