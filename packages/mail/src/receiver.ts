import { buildInboundEmail } from "./inbound";
import type { EmailHandlerOptions } from "./types";

/**
 * Create an email handler for the Workers email() export.
 * Parses the inbound email and passes a typed InboundEmail to your handler.
 */
export function createEmailHandler<Env = unknown>(
	options: EmailHandlerOptions<Env>,
): (message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) => Promise<void> {
	return async (message, env, ctx) => {
		const inbound = await buildInboundEmail(message);

		try {
			await options.handler(inbound, env, ctx);
		} catch (error) {
			if (options.onError) {
				await options.onError(error, inbound);
			} else {
				throw error;
			}
		}
	};
}
