import { beforeEach, describe, expect, it } from "vitest";
import { createJournal } from "../src/journal";
import type { StepJournalEntry } from "../src/types";

function createInMemoryStorage() {
	const store = new Map<string, unknown>();
	return {
		async get<T>(key: string): Promise<T | undefined> {
			return store.get(key) as T | undefined;
		},
		async put(key: string, value: unknown): Promise<void> {
			store.set(key, value);
		},
		_store: store,
	};
}

function makeEntry(overrides: Partial<StepJournalEntry> = {}): StepJournalEntry {
	return {
		index: 0,
		name: "testStep",
		status: "completed",
		input: { foo: "bar" },
		output: { result: 42 },
		attempt: 1,
		startedAt: Date.now(),
		completedAt: Date.now() + 100,
		duration: 100,
		...overrides,
	};
}

describe("createJournal", () => {
	let storage: ReturnType<typeof createInMemoryStorage>;
	let journal: ReturnType<typeof createJournal>;

	beforeEach(() => {
		storage = createInMemoryStorage();
		journal = createJournal(storage);
	});

	describe("writeEntry / readEntry", () => {
		it("round-trips a journal entry", async () => {
			const entry = makeEntry({ index: 0, name: "step1" });
			await journal.writeEntry(0, entry);
			const read = await journal.readEntry(0);
			expect(read).toEqual(entry);
		});

		it("stores entry under correct key (wf:step:N)", async () => {
			const entry = makeEntry({ index: 3, name: "step4" });
			await journal.writeEntry(3, entry);
			const raw = await storage.get("wf:step:3");
			expect(raw).toEqual(entry);
		});

		it("returns undefined for missing entry", async () => {
			const read = await journal.readEntry(99);
			expect(read).toBeUndefined();
		});

		it("overwrites an existing entry", async () => {
			const original = makeEntry({ index: 0, status: "running" });
			const updated = makeEntry({ index: 0, status: "completed" });
			await journal.writeEntry(0, original);
			await journal.writeEntry(0, updated);
			const read = await journal.readEntry(0);
			expect(read?.status).toBe("completed");
		});
	});

	describe("readAll", () => {
		it("returns empty array when step count is 0", async () => {
			const all = await journal.readAll();
			expect(all).toEqual([]);
		});

		it("returns all entries in order", async () => {
			const entries = [
				makeEntry({ index: 0, name: "step1" }),
				makeEntry({ index: 1, name: "step2" }),
				makeEntry({ index: 2, name: "step3" }),
			];
			for (const e of entries) {
				await journal.writeEntry(e.index, e);
			}
			await journal.setStepCount(3);
			const all = await journal.readAll();
			expect(all).toHaveLength(3);
			expect(all[0]?.name).toBe("step1");
			expect(all[1]?.name).toBe("step2");
			expect(all[2]?.name).toBe("step3");
		});

		it("skips missing entries in range", async () => {
			await journal.writeEntry(0, makeEntry({ index: 0, name: "step1" }));
			// skip index 1
			await journal.writeEntry(2, makeEntry({ index: 2, name: "step3" }));
			await journal.setStepCount(3);
			const all = await journal.readAll();
			expect(all).toHaveLength(2);
			expect(all[0]?.name).toBe("step1");
			expect(all[1]?.name).toBe("step3");
		});
	});

	describe("step count tracking", () => {
		it("returns 0 when no count is set", async () => {
			const count = await journal.getStepCount();
			expect(count).toBe(0);
		});

		it("sets and reads step count", async () => {
			await journal.setStepCount(5);
			const count = await journal.getStepCount();
			expect(count).toBe(5);
		});

		it("stores count under wf:step:count key", async () => {
			await journal.setStepCount(7);
			const raw = await storage.get("wf:step:count");
			expect(raw).toBe(7);
		});

		it("updates count correctly", async () => {
			await journal.setStepCount(3);
			await journal.setStepCount(10);
			const count = await journal.getStepCount();
			expect(count).toBe(10);
		});
	});

	describe("meta read/write", () => {
		it("writes and reads meta", async () => {
			const meta = { executionId: "wf_abc123", status: "running", stepCount: 3 };
			await journal.writeMeta(meta);
			const read = await journal.readMeta();
			expect(read).toEqual(meta);
		});

		it("returns undefined when no meta written", async () => {
			const read = await journal.readMeta();
			expect(read).toBeUndefined();
		});

		it("stores meta under wf:meta key", async () => {
			const meta = { status: "completed" };
			await journal.writeMeta(meta);
			const raw = await storage.get("wf:meta");
			expect(raw).toEqual(meta);
		});

		it("overwrites existing meta", async () => {
			await journal.writeMeta({ status: "running" });
			await journal.writeMeta({ status: "completed" });
			const read = await journal.readMeta();
			expect(read).toEqual({ status: "completed" });
		});
	});

	describe("input read/write", () => {
		it("writes and reads input", async () => {
			const input = { userId: "u_123", action: "process" };
			await journal.writeInput(input);
			const read = await journal.readInput();
			expect(read).toEqual(input);
		});

		it("returns undefined when no input written", async () => {
			const read = await journal.readInput();
			expect(read).toBeUndefined();
		});

		it("handles primitive inputs", async () => {
			await journal.writeInput(42);
			expect(await journal.readInput()).toBe(42);

			await journal.writeInput("hello");
			expect(await journal.readInput()).toBe("hello");
		});
	});
});
