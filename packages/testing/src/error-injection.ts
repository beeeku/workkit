export interface ErrorInjection {
	failAfter(n: number, error?: Error): void;
	failOn(pattern: RegExp, error?: Error): void;
	withLatency(minMs: number, maxMs?: number): void;
	clearInjections(): void;
}

export interface InjectionState {
	failAfterCount: number | null;
	failAfterError: Error;
	operationCount: number;
	failPatterns: Array<{ pattern: RegExp; error: Error }>;
	latency: { min: number; max: number } | null;
}

export function createErrorInjector(): ErrorInjection & {
	_check(key?: string): Promise<void>;
	_state: InjectionState;
} {
	const state: InjectionState = {
		failAfterCount: null,
		failAfterError: new Error("Injected error"),
		operationCount: 0,
		failPatterns: [],
		latency: null,
	};

	return {
		_state: state,

		failAfter(n: number, error?: Error) {
			state.failAfterCount = n;
			state.operationCount = 0;
			if (error) state.failAfterError = error;
		},

		failOn(pattern: RegExp, error?: Error) {
			state.failPatterns.push({
				pattern,
				error: error ?? new Error("Injected error"),
			});
		},

		withLatency(minMs: number, maxMs?: number) {
			state.latency = { min: minMs, max: maxMs ?? minMs };
		},

		clearInjections() {
			state.failAfterCount = null;
			state.failAfterError = new Error("Injected error");
			state.operationCount = 0;
			state.failPatterns = [];
			state.latency = null;
		},

		async _check(key?: string) {
			// Increment operation count
			state.operationCount++;

			// Check failAfter
			if (state.failAfterCount !== null && state.operationCount > state.failAfterCount) {
				throw state.failAfterError;
			}

			// Check failOn patterns
			if (key) {
				for (const { pattern, error } of state.failPatterns) {
					if (pattern.test(key)) {
						throw error;
					}
				}
			}

			// Apply latency
			if (state.latency) {
				const { min, max } = state.latency;
				const delay = min + Math.random() * (max - min);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		},
	};
}
