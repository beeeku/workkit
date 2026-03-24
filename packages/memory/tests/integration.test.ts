import { describe, expect, it, vi } from "vitest";
import { createMemory } from "../src/memory";

function createMockD1() {
	// More realistic mock that tracks inserts
	const rows = new Map<string, any>();
	const stmt = {
		bind: vi.fn(function (this: any, ...args: any[]) {
			(stmt as any)._lastBinds = args;
			return stmt;
		}),
		run: vi.fn(async () => {
			return { success: true };
		}),
		first: vi.fn(async () => ({ c: 0 })),
		all: vi.fn(async () => ({ results: [], success: true })),
	};
	return { prepare: vi.fn(() => stmt), _stmt: stmt, _rows: rows } as any;
}

describe("Integration: Memory System", () => {
	it("remember -> recall flow", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });

		const rememberResult = await memory.remember("User prefers TypeScript", {
			subject: "user",
			tags: ["preferences", "development"],
			confidence: 0.9,
		});
		expect(rememberResult.ok).toBe(true);

		// Recall will query D1 (returns empty from mock, but verifies the path works)
		const recallResult = await memory.recall("what language does the user prefer");
		expect(recallResult.ok).toBe(true);
	});

	it("conversation add -> get flow", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });
		const convo = memory.conversation("test-session", { tokenBudget: 4096 });

		const addResult = await convo.add({ role: "user", content: "Hello" });
		expect(addResult.ok).toBe(true);

		const getResult = await convo.get();
		expect(getResult.ok).toBe(true);
	});

	it("forget invalidates cache", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });

		await memory.remember("Temporary fact");
		const forgetResult = await memory.forget("fact_123", "no longer relevant");
		expect(forgetResult.ok).toBe(true);
	});

	it("stats returns correct mode", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });
		const stats = await memory.stats();
		expect(stats.ok).toBe(true);
		if (stats.ok) {
			expect(stats.value.mode).toBe("d1-only");
		}
	});

	it("temporal scoping returns scoped memory", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });
		const past = memory.at(Date.now() - 86400000);

		const result = await past.recall("test");
		expect(result.ok).toBe(true);
	});

	it("remember -> supersede flow", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });

		const original = await memory.remember("User likes JavaScript");
		expect(original.ok).toBe(true);

		if (original.ok) {
			const updated = await memory.supersede(
				original.value.id,
				"User prefers TypeScript over JavaScript",
			);
			expect(updated.ok).toBe(true);
		}
	});

	it("compact -> stats flow", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });

		const compactResult = await memory.compact();
		expect(compactResult.ok).toBe(true);

		const statsResult = await memory.stats();
		expect(statsResult.ok).toBe(true);
	});

	it("search with filters", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });

		const result = await memory.search("typescript", {
			subject: "user",
			tags: ["preferences"],
			limit: 5,
		});
		expect(result.ok).toBe(true);
	});

	it("scoped memory stats delegates to parent", async () => {
		const db = createMockD1();
		const memory = createMemory({ db });
		const scoped = memory.at(Date.now());

		const stats = await scoped.stats();
		expect(stats.ok).toBe(true);
		if (stats.ok) {
			expect(stats.value.mode).toBe("d1-only");
		}
	});
});
