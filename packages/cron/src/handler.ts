import type { ExecutionContext, ScheduledEvent } from "@workkit/types";
import { matchCron } from "./matcher";
import type { CronHandler, CronHandlerOptions, CronMiddleware, CronTaskHandler } from "./types";

/**
 * Apply middleware stack to a handler.
 * Middleware is applied left-to-right (outermost first).
 */
function applyMiddleware<E>(
	handler: CronTaskHandler<E>,
	middleware: CronMiddleware<E>[],
	taskName: string,
): CronTaskHandler<E> {
	let wrapped = handler;
	// Apply in reverse so the first middleware is outermost
	for (let i = middleware.length - 1; i >= 0; i--) {
		wrapped = middleware[i](wrapped, taskName);
	}
	return wrapped;
}

/**
 * Create a scheduled event handler that routes incoming cron triggers
 * to matching task handlers.
 *
 * @param options Handler configuration with tasks and optional middleware
 * @returns An async handler compatible with Workers scheduled() export
 */
export function createCronHandler<E = unknown>(options: CronHandlerOptions<E>): CronHandler<E> {
	const { tasks, middleware = [], onNoMatch } = options;

	return async (event: ScheduledEvent, env: E, ctx: ExecutionContext): Promise<void> => {
		const matched: { name: string; handler: CronTaskHandler<E> }[] = [];

		for (const [name, task] of Object.entries(tasks)) {
			if (matchCron(task.schedule, event.cron)) {
				const wrappedHandler =
					middleware.length > 0 ? applyMiddleware(task.handler, middleware, name) : task.handler;
				matched.push({ name, handler: wrappedHandler });
			}
		}

		if (matched.length === 0) {
			if (onNoMatch) {
				await onNoMatch(event, env, ctx);
			}
			return;
		}

		// Run all matching tasks. If any throws, propagate the first error.
		const errors: Error[] = [];

		for (const { handler } of matched) {
			try {
				await handler(event, env, ctx);
			} catch (error) {
				errors.push(error instanceof Error ? error : new Error(String(error)));
			}
		}

		if (errors.length > 0) {
			throw errors[0];
		}
	};
}
