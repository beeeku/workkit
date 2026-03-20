import { beforeEach, describe, expect, it } from "vitest";
import { queue } from "../src/producer";
import { createMockProducer } from "./helpers/mock-queue";

type UserEvent = { type: "created" | "updated"; userId: string };

describe("queue() factory", () => {
	it("throws BindingNotFoundError for null binding", () => {
		expect(() => queue<UserEvent>(null as any)).toThrow();
	});

	it("throws BindingNotFoundError for undefined binding", () => {
		expect(() => queue<UserEvent>(undefined as any)).toThrow();
	});

	it("creates a TypedQueueProducer instance", () => {
		const mock = createMockProducer<UserEvent>();
		const q = queue<UserEvent>(mock as any);
		expect(q).toBeDefined();
		expect(typeof q.send).toBe("function");
		expect(typeof q.sendBatch).toBe("function");
	});

	it("exposes .raw as the original queue binding", () => {
		const mock = createMockProducer<UserEvent>();
		const q = queue<UserEvent>(mock as any);
		expect(q.raw).toBe(mock);
	});
});

describe("send()", () => {
	let mock: ReturnType<typeof createMockProducer<UserEvent>>;
	let q: ReturnType<typeof queue<UserEvent>>;

	beforeEach(() => {
		mock = createMockProducer<UserEvent>();
		q = queue<UserEvent>(mock as any);
	});

	it("sends a typed message body", async () => {
		await q.send({ type: "created", userId: "123" });
		expect(mock._sent).toHaveLength(1);
		expect(mock._sent[0].body).toEqual({ type: "created", userId: "123" });
	});

	it("passes options through to the underlying queue", async () => {
		await q.send({ type: "updated", userId: "456" }, { delaySeconds: 30 });
		expect(mock._sent[0].options).toEqual({ delaySeconds: 30 });
	});

	it("can send multiple messages sequentially", async () => {
		await q.send({ type: "created", userId: "1" });
		await q.send({ type: "updated", userId: "2" });
		await q.send({ type: "created", userId: "3" });
		expect(mock._sent).toHaveLength(3);
	});

	it("passes contentType option", async () => {
		await q.send({ type: "created", userId: "1" }, { contentType: "json" });
		expect(mock._sent[0].options).toEqual({ contentType: "json" });
	});
});

describe("sendBatch()", () => {
	let mock: ReturnType<typeof createMockProducer<UserEvent>>;
	let q: ReturnType<typeof queue<UserEvent>>;

	beforeEach(() => {
		mock = createMockProducer<UserEvent>();
		q = queue<UserEvent>(mock as any);
	});

	it("sends a batch of typed messages", async () => {
		await q.sendBatch([
			{ body: { type: "created", userId: "1" } },
			{ body: { type: "updated", userId: "2" } },
		]);
		expect(mock._batchSent).toHaveLength(1);
		expect(mock._batchSent[0]).toHaveLength(2);
	});

	it("passes per-message options in batch", async () => {
		await q.sendBatch([
			{ body: { type: "created", userId: "1" }, delaySeconds: 10 },
			{ body: { type: "updated", userId: "2" }, contentType: "json" },
		]);
		const batch = mock._batchSent[0];
		expect(batch[0].delaySeconds).toBe(10);
		expect(batch[1].contentType).toBe("json");
	});

	it("handles empty batch", async () => {
		await q.sendBatch([]);
		expect(mock._batchSent).toHaveLength(1);
		expect(mock._batchSent[0]).toHaveLength(0);
	});

	it("can send multiple batches", async () => {
		await q.sendBatch([{ body: { type: "created", userId: "1" } }]);
		await q.sendBatch([{ body: { type: "updated", userId: "2" } }]);
		expect(mock._batchSent).toHaveLength(2);
	});
});
