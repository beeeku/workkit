import type { InboundEmail } from "@workkit/mail";
import { parseBounceDSN } from "@workkit/mail";
import type { EmailOptOutHook } from "./providers/resend";

export interface BounceRouteOptions {
	/**
	 * Called when a hard bounce DSN is parsed. Same shape as the Resend
	 * provider's `autoOptOut.hook` so consumers can share one implementation
	 * across both transports. The reason is always `"hard-bounce"`; soft
	 * bounces don't fire the hook (auto-opting-out on a transient delivery
	 * failure would silently lose real subscribers).
	 */
	readonly optOutHook: EmailOptOutHook;
	/**
	 * Optional. Called when an email arrives at the bounce route but isn't
	 * a DSN — typically a misrouted reply, an auto-responder, or a delayed
	 * notification. Default: no-op (silently drop). Use this to log or to
	 * route the message somewhere else.
	 */
	readonly onNonBounce?: (email: InboundEmail) => void | Promise<void>;
}

/**
 * Build an inbound-email handler that drives `autoOptOut` from RFC 3464
 * delivery-status notifications. Restores bounce-driven opt-out parity for
 * the Cloudflare `send_email` transport, which has no delivery-webhook
 * surface (so the Resend-style provider webhook isn't available — see
 * `cloudflareEmailProvider`).
 *
 * Wire it into `createEmailRouter()` from `@workkit/mail` against whichever
 * inbound mailbox you've configured for bounces in Cloudflare Email
 * Routing (commonly `bounces@yourdomain`).
 *
 * ```ts
 * import { createEmailRouter } from "@workkit/mail";
 * import { createBounceRoute } from "@workkit/notify/email";
 * import { optOut } from "@workkit/notify";
 *
 * const bounces = createBounceRoute({
 *   optOutHook: async (address, channel, _nid, reason) => {
 *     const userId = await lookupUserIdByEmail(address);
 *     if (userId) await optOut(env.DB, userId, channel, null, reason);
 *   },
 * });
 *
 * export default {
 *   email: createEmailRouter()
 *     .match((e) => e.to === "bounces@yourdomain.com", bounces)
 *     .default((e) => e.setReject("Unknown recipient"))
 *     .handle,
 * };
 * ```
 *
 * Errors from `optOutHook` propagate to the caller — Email Routing will
 * see the rejection and the MTA will retry. If you'd rather swallow
 * transient hook failures, wrap the hook yourself.
 */
export function createBounceRoute(
	opts: BounceRouteOptions,
): (email: InboundEmail) => Promise<void> {
	return async (email) => {
		const bounce = parseBounceDSN(email);
		if (!bounce) {
			await opts.onNonBounce?.(email);
			return;
		}
		// Only hard bounces auto-opt-out. Soft bounces (`Status: 4.x`,
		// e.g. mailbox full) recover on retry — opting the user out on
		// the first 4xx would drop legitimate subscribers.
		if (bounce.kind === "hard") {
			await opts.optOutHook(bounce.recipient, "email", null, "hard-bounce");
		}
	};
}
