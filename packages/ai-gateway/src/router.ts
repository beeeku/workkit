import { ConfigError } from "@workkit/errors";
import type { Route, Router, RouterConfig } from "./types";

/**
 * Match a model name against a glob-like pattern.
 * Supports `*` as a wildcard that matches any characters.
 * Matching is case-insensitive.
 */
function matchPattern(pattern: string, model: string): boolean {
	// Escape regex special chars except *, then convert * to .*
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	const regex = new RegExp(`^${escaped}$`, "i");
	return regex.test(model);
}

/**
 * Create a model router that maps model names to provider keys.
 *
 * Routes are evaluated in order — first match wins.
 * If no route matches, the fallback provider is used.
 *
 * @example
 * ```ts
 * const router = createRouter({
 *   routes: [
 *     { pattern: 'gpt-*', provider: 'openai' },
 *     { pattern: 'claude-*', provider: 'anthropic' },
 *     { pattern: '@cf/*', provider: 'workers-ai' },
 *   ],
 *   fallback: 'workers-ai',
 * })
 *
 * router.resolve('gpt-4')  // 'openai'
 * router.resolve('unknown') // 'workers-ai'
 * ```
 */
export function createRouter(config: RouterConfig): Router {
	if (!config.routes || config.routes.length === 0) {
		throw new ConfigError("Router requires at least one route", {
			context: { routes: config.routes },
		});
	}

	if (!config.fallback) {
		throw new ConfigError("Router requires a fallback provider", {
			context: { fallback: config.fallback },
		});
	}

	// Validate routes
	for (const route of config.routes) {
		if (!route.pattern) {
			throw new ConfigError("Route pattern cannot be empty", {
				context: { route },
			});
		}
		if (!route.provider) {
			throw new ConfigError("Route provider cannot be empty", {
				context: { route },
			});
		}
	}

	const frozenRoutes = Object.freeze([...config.routes]);

	return {
		resolve(model: string): string {
			if (!model) {
				return config.fallback;
			}

			for (const route of frozenRoutes) {
				if (matchPattern(route.pattern, model)) {
					return route.provider;
				}
			}

			return config.fallback;
		},

		routes(): readonly Route[] {
			return frozenRoutes;
		},
	};
}
