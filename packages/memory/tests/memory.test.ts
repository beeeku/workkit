import { describe, expect, it, vi } from "vitest";
import { createMemory } from "../src/memory";

function createMockD1() {
	const stmt = {
		bind: vi.fn().mockReturnThis(),
		run: vi.fn(async () => ({ success: true })),
		first: vi.fn(async () => ({ c: 0 })),
		all: vi.fn(async () => ({ results: [], success: true })),
	};
	return { prepare: vi.fn(() => stmt), _stmt: stmt } as any;
}

describe("createMemory", () => {
	it("creates a Memory instance with minimal config", () => {
		const memory = createMemory({ db: createMockD1() });
		expect(memory).toBeDefined();
		expect(memory.remember).toBeDefined();
		expect(memory.recall).toBeDefined();
		expect(memory.search).toBeDefined();
		expect(memory.get).toBeDefined();
		expect(memory.forget).toBeDefined();
		expect(memory.supersede).toBeDefined();
		expect(memory.expire).toBeDefined();
		expect(memory.at).toBeDefined();
		expect(memory.conversation).toBeDefined();
		expect(memory.stats).toBeDefined();
		expect(memory.compact).toBeDefined();
		expect(memory.reembed).toBeDefined();
	});

	it("remember stores a fact", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });
		const result = await memory.remember("Test fact");
		expect(result.ok).toBe(true);
	});

	it("stats returns memory statistics", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });
		const result = await memory.stats();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.mode).toBe("d1-only");
			expect(result.value.embeddingModel).toBe("@cf/baai/bge-base-en-v1.5");
		}
	});

	it("conversation returns a Conversation instance", () => {
		const db = createMockD1();
		const memory = createMemory({ db });
		const convo = memory.conversation("test-session");
		expect(convo.id).toBe("test-session");
		expect(convo.add).toBeDefined();
		expect(convo.get).toBeDefined();
	});

	it("at returns a ScopedMemory", () => {
		const db = createMockD1();
		const memory = createMemory({ db });
		const scoped = memory.at(Date.now());
		expect(scoped.recall).toBeDefined();
		expect(scoped.search).toBeDefined();
		expect(scoped.get).toBeDefined();
		expect(scoped.stats).toBeDefined();
	});

	it("reembed fails without AI binding", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });
		const result = await memory.reembed();
		expect(result.ok).toBe(false);
	});

	it("forget invalidates cache and delegates to fact store", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });
		const result = await memory.forget("fact_abc", "no longer needed");
		expect(result.ok).toBe(true);
	});

	it("supersede delegates to fact store and invalidates cache", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });
		const result = await memory.supersede("fact_old", "Updated fact text");
		expect(result.ok).toBe(true);
	});

	it("expire delegates to fact store", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });
		const result = await memory.expire("fact_abc", 3600);
		expect(result.ok).toBe(true);
	});

	it("search delegates to search module", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });
		const result = await memory.search("test query");
		expect(result.ok).toBe(true);
	});

	it("compact cleans expired facts", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });
		const result = await memory.compact();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.mergedCount).toBe(0);
			expect(result.value.expiredCount).toBe(0);
			expect(typeof result.value.durationMs).toBe("number");
		}
	});

	it("rememberBatch stores multiple facts", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });
		const result = await memory.rememberBatch([
			{ fact: "Fact one" },
			{ fact: "Fact two", metadata: { tags: ["test"] } },
		]);
		expect(result.ok).toBe(true);
	});

	it("recall returns results from D1", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });
		const result = await memory.recall("test query");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(Array.isArray(result.value)).toBe(true);
		}
	});

	it("recall with noCache skips cache", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });
		const result = await memory.recall("test query", { noCache: true });
		expect(result.ok).toBe(true);
	});

	it("get retrieves a single fact", async () => {
		const db = createMockD1();
		// first() returns null for non-existent fact
		db._stmt.first.mockResolvedValueOnce(null);
		const memory = createMemory({ db });
		const result = await memory.get("fact_nonexistent");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toBeNull();
		}
	});
});
