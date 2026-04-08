import { buildInboundEmail } from "./inbound";
import type { EmailHandlerFn, EmailRoute, EmailRouteMatcher, EmailRouter } from "./types";

/**
 * Create a pattern-matching email router for inbound emails.
 * Routes are checked in order — first match wins.
 */
export function createEmailRouter<Env = unknown>(): EmailRouter<Env> {
	const routes: EmailRoute<Env>[] = [];
	let defaultHandler: EmailHandlerFn<Env> | undefined;

	const router: EmailRouter<Env> = {
		match(predicate: EmailRouteMatcher, handler: EmailHandlerFn<Env>): EmailRouter<Env> {
			routes.push({ match: predicate, handler });
			return router;
		},

		default(handler: EmailHandlerFn<Env>): EmailRouter<Env> {
			defaultHandler = handler;
			return router;
		},

		async handle(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
			const inbound = await buildInboundEmail(message);

			// Check routes in order
			for (const route of routes) {
				if (route.match(inbound)) {
					await route.handler(inbound, env, ctx);
					return;
				}
			}

			// No match — use default or reject
			if (defaultHandler) {
				await defaultHandler(inbound, env, ctx);
			} else {
				message.setReject("No handler matched this email");
			}
		},
	};

	return router;
}
