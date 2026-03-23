import { ValidationError } from "@workkit/errors";
import type { ExecutionContext, ScheduledEvent } from "@workkit/types";
import { matchCron } from "./matcher";
import type {
	CronHandler,
	CronHandlerOptions,
	CronMiddleware,
	CronTask,
	CronTaskHandler,
} from "./types";

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
		wrapped = middleware[i]!(wrapped, taskName);
	}
	return wrapped;
}

/**
 * Topological sort using Kahn's algorithm.
 * Returns task names in dependency order.
 * Throws ValidationError if a cycle is detected.
 */
function topoSort(taskNames: string[], tasks: Record<string, CronTask<unknown>>): string[] {
	// Build adjacency list and in-degree map
	const inDegree = new Map<string, number>();
	const dependents = new Map<string, string[]>();
	const taskSet = new Set(taskNames);

	for (const name of taskNames) {
		inDegree.set(name, 0);
		dependents.set(name, []);
	}

	for (const name of taskNames) {
		const deps = tasks[name]?.after ?? [];
		for (const dep of deps) {
			if (taskSet.has(dep)) {
				inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
				dependents.get(dep)!.push(name);
			}
		}
	}

	// Collect nodes with no incoming edges
	const queue: string[] = [];
	for (const name of taskNames) {
		if (inDegree.get(name) === 0) {
			queue.push(name);
		}
	}

	const sorted: string[] = [];
	while (queue.length > 0) {
		const node = queue.shift()!;
		sorted.push(node);
		for (const dep of dependents.get(node) ?? []) {
			const newDegree = (inDegree.get(dep) ?? 1) - 1;
			inDegree.set(dep, newDegree);
			if (newDegree === 0) {
				queue.push(dep);
			}
		}
	}

	if (sorted.length !== taskNames.length) {
		throw new ValidationError("Circular dependency detected in task definitions", [
			{ path: ["tasks"], message: "Tasks contain circular dependencies" },
		]);
	}

	return sorted;
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

	// Validate dependencies at creation time — detect cycles early
	const allNames = Object.keys(tasks);
	topoSort(allNames, tasks as Record<string, CronTask<unknown>>);

	return async (event: ScheduledEvent, env: E, ctx: ExecutionContext): Promise<void> => {
		const matchedMap = new Map<string, CronTaskHandler<E>>();

		for (const [name, task] of Object.entries(tasks)) {
			if (matchCron(task.schedule, event.cron)) {
				const wrappedHandler =
					middleware.length > 0 ? applyMiddleware(task.handler, middleware, name) : task.handler;
				matchedMap.set(name, wrappedHandler);
			}
		}

		if (matchedMap.size === 0) {
			if (onNoMatch) {
				await onNoMatch(event, env, ctx);
			}
			return;
		}

		// Topological sort of matched tasks
		const matchedNames = [...matchedMap.keys()];
		const sorted = topoSort(matchedNames, tasks as Record<string, CronTask<unknown>>);

		// Execute in dependency order, tracking failures
		const failed = new Set<string>();
		const errors: Error[] = [];

		for (const name of sorted) {
			// Skip if any dependency failed
			const deps = tasks[name]?.after ?? [];
			const depFailed = deps.some((dep) => failed.has(dep));
			if (depFailed) {
				failed.add(name);
				continue;
			}

			const handler = matchedMap.get(name)!;
			try {
				await handler(event, env, ctx);
			} catch (error) {
				failed.add(name);
				errors.push(error instanceof Error ? error : new Error(String(error)));
			}
		}

		if (errors.length > 0) {
			throw errors[0];
		}
	};
}
