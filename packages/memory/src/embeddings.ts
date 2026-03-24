export interface EmbeddingPipelineOptions {
	ai?: Ai;
	model?: string;
	dimensions?: number;
}

export function createEmbeddingPipeline(options?: EmbeddingPipelineOptions) {
	const ai = options?.ai;
	const model = options?.model ?? "@cf/baai/bge-base-en-v1.5";
	const dimensions = options?.dimensions ?? 768;

	return {
		get enabled() {
			return !!ai;
		},
		get dimensions() {
			return dimensions;
		},

		async embed(text: string): Promise<number[] | null> {
			if (!ai) return null;
			try {
				// Truncate to ~512 tokens
				const truncated = text.slice(0, 512 * 4);
				const result = await ai.run(model as any, { text: [truncated] });
				return (result as any).data?.[0] ?? null;
			} catch {
				return null;
			}
		},

		async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
			if (!ai) return texts.map(() => null);
			try {
				const truncated = texts.map((t) => t.slice(0, 512 * 4));
				const result = await ai.run(model as any, { text: truncated });
				const data = (result as any).data;
				if (!Array.isArray(data) || data.length !== texts.length) {
					return texts.map(() => null);
				}
				return data;
			} catch {
				return texts.map(() => null);
			}
		},

		async storeEmbedding(factId: string, vector: number[], db: D1Database): Promise<void> {
			if (
				!Array.isArray(vector) ||
				vector.length === 0 ||
				!vector.every((v) => typeof v === "number" && isFinite(v))
			) {
				throw new Error(`Invalid embedding vector for fact ${factId}: must be a non-empty array of finite numbers`);
			}
			await db
				.prepare(
					"INSERT OR REPLACE INTO fact_embeddings (fact_id, vector, dimensions) VALUES (?, ?, ?)",
				)
				.bind(factId, JSON.stringify(vector), vector.length)
				.run();
		},

		async loadEmbeddings(factIds: string[], db: D1Database): Promise<Map<string, number[]>> {
			if (factIds.length === 0) return new Map();
			const placeholders = factIds.map(() => "?").join(",");
			const { results } = await db
				.prepare(`SELECT fact_id, vector FROM fact_embeddings WHERE fact_id IN (${placeholders})`)
				.bind(...factIds)
				.all();
			const map = new Map<string, number[]>();
			for (const row of results) {
				try {
					const parsed = JSON.parse(row.vector as string);
					if (
						Array.isArray(parsed) &&
						parsed.length > 0 &&
						parsed.every((v: unknown) => typeof v === "number" && isFinite(v))
					) {
						map.set(row.fact_id as string, parsed);
					}
					// Skip silently if vector is invalid — embeddings can be regenerated
				} catch {
					// Skip rows with unparseable vectors
				}
			}
			return map;
		},

		async retryPending(db: D1Database, limit = 5): Promise<number> {
			if (!ai) return 0;
			const { results } = await db
				.prepare("SELECT id, text FROM facts WHERE embedding_status = 'pending' LIMIT ?")
				.bind(limit)
				.all();
			if (results.length === 0) return 0;

			let count = 0;
			for (const row of results) {
				const vector = await this.embed(row.text as string);
				if (vector) {
					await this.storeEmbedding(row.id as string, vector, db);
					await db
						.prepare("UPDATE facts SET embedding_status = 'complete' WHERE id = ?")
						.bind(row.id)
						.run();
					count++;
				} else {
					// Mark as failed to prevent infinite retry loop
					await db
						.prepare("UPDATE facts SET embedding_status = 'failed' WHERE id = ?")
						.bind(row.id)
						.run();
				}
			}
			return count;
		},
	};
}
