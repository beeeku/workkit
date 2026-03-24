import type {
	Fact,
	MemoryResult,
	MemoryStats,
	RecallOptions,
	RecallResult,
	ScopedMemory,
	SearchOptions,
} from "./types";

export interface TemporalDeps {
	recall: (query: string, options?: RecallOptions) => Promise<MemoryResult<RecallResult[]>>;
	search: (query: string, options?: SearchOptions) => Promise<MemoryResult<Fact[]>>;
	get: (factId: string) => Promise<MemoryResult<Fact | null>>;
	stats: () => Promise<MemoryResult<MemoryStats>>;
}

/**
 * createScopedMemory returns a ScopedMemory view where all reads are
 * constrained to facts that existed at or before the given timestamp.
 *
 * For v0.1.0 this is a thin wrapper that delegates to the parent memory's
 * recall/search/get/stats with { timeRange: { to: timestamp } } and
 * { includeSuperseded: false } applied automatically.
 */
export function createScopedMemory(timestamp: number, deps: TemporalDeps): ScopedMemory {
	return {
		async recall(query: string, options?: RecallOptions): Promise<MemoryResult<RecallResult[]>> {
			return deps.recall(query, {
				...options,
				timeRange: {
					...(options?.timeRange ?? {}),
					to: timestamp,
				},
				includeSuperseded: options?.includeSuperseded ?? false,
			});
		},

		async search(query: string, options?: SearchOptions): Promise<MemoryResult<Fact[]>> {
			return deps.search(query, {
				...options,
				timeRange: {
					...(options?.timeRange ?? {}),
					to: timestamp,
				},
				includeSuperseded: options?.includeSuperseded ?? false,
			});
		},

		async get(factId: string): Promise<MemoryResult<Fact | null>> {
			const result = await deps.get(factId);
			if (!result.ok) return result;

			// If the fact exists but was created after the scoped timestamp, hide it
			if (result.value !== null && result.value.validFrom > timestamp) {
				return { ok: true, value: null };
			}

			return result;
		},

		async stats(): Promise<MemoryResult<MemoryStats>> {
			return deps.stats();
		},
	};
}
