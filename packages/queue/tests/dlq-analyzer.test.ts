import { beforeEach, describe, expect, it } from "vitest";
import { createDLQAnalyzer } from "../src/dlq-analyzer";
import type { DLQMetadata } from "../src/types";
import { createMockKV } from "./helpers/mock-kv";
import { createMockMessage, resetMessageIdCounter } from "./helpers/mock-queue";

type UserEvent = { type: "created" | "updated"; userId: string };

function createMetadata(overrides?: Partial<DLQMetadata>): DLQMetadata {
	return {
		queue: overrides?.queue ?? "test-queue",
		attempts: overrides?.attempts ?? 3,
		messageId: overrides?.messageId ?? "msg-1",
		timestamp: overrides?.timestamp ?? new Date("2025-01-01T12:00:00Z"),
	};
}

describe("createDLQAnalyzer()", () => {
	beforeEach(() => {
		resetMessageIdCounter();
	});

	it("records a failure and returns it in summary", async () => {
		const kv = createMockKV();
		const analyzer = createDLQAnalyzer<UserEvent>({ namespace: kv });

		const msg = createMockMessage<UserEvent>({ type: "created", userId: "1" });
		const metadata = createMetadata({ messageId: msg.id });

		await analyzer.record(msg as any, metadata, new Error("connection timeout"));

		const summary = await analyzer.summary();
		expect(summary.total).toBe(1);
		expect(summary.byQueue["test-queue"]).toBe(1);
	});

	it("aggregates multiple failures", async () => {
		const kv = createMockKV();
		const analyzer = createDLQAnalyzer<UserEvent>({ namespace: kv });

		for (let i = 0; i < 5; i++) {
			const msg = createMockMessage<UserEvent>({ type: "created", userId: `${i}` });
			const metadata = createMetadata({ messageId: msg.id });
			await analyzer.record(msg as any, metadata, new Error("timeout"));
		}

		const summary = await analyzer.summary();
		expect(summary.total).toBe(5);
	});

	it("groups errors by message and counts them", async () => {
		const kv = createMockKV();
		const analyzer = createDLQAnalyzer<UserEvent>({ namespace: kv });

		// 3 timeout errors
		for (let i = 0; i < 3; i++) {
			const msg = createMockMessage<UserEvent>({ type: "created", userId: `${i}` });
			await analyzer.record(msg as any, createMetadata({ messageId: msg.id }), new Error("timeout"));
		}

		// 2 auth errors
		for (let i = 0; i < 2; i++) {
			const msg = createMockMessage<UserEvent>({ type: "updated", userId: `${i}` });
			await analyzer.record(
				msg as any,
				createMetadata({ messageId: msg.id }),
				new Error("auth failed"),
			);
		}

		const errors = await analyzer.topErrors();
		expect(errors).toHaveLength(2);
		expect(errors[0].message).toBe("timeout");
		expect(errors[0].count).toBe(3);
		expect(errors[1].message).toBe("auth failed");
		expect(errors[1].count).toBe(2);
	});

	it("returns topErrors sorted by count descending", async () => {
		const kv = createMockKV();
		const analyzer = createDLQAnalyzer<UserEvent>({ namespace: kv });

		const msg1 = createMockMessage<UserEvent>({ type: "created", userId: "1" });
		await analyzer.record(msg1 as any, createMetadata({ messageId: msg1.id }), new Error("rare"));

		for (let i = 0; i < 5; i++) {
			const msg = createMockMessage<UserEvent>({ type: "created", userId: `${i}` });
			await analyzer.record(
				msg as any,
				createMetadata({ messageId: msg.id }),
				new Error("common"),
			);
		}

		const errors = await analyzer.topErrors();
		expect(errors[0].message).toBe("common");
		expect(errors[0].count).toBe(5);
		expect(errors[1].message).toBe("rare");
		expect(errors[1].count).toBe(1);
	});

	it("respects limit parameter in topErrors", async () => {
		const kv = createMockKV();
		const analyzer = createDLQAnalyzer<UserEvent>({ namespace: kv });

		for (let i = 0; i < 5; i++) {
			const msg = createMockMessage<UserEvent>({ type: "created", userId: `${i}` });
			await analyzer.record(
				msg as any,
				createMetadata({ messageId: msg.id }),
				new Error(`error-${i}`),
			);
		}

		const errors = await analyzer.topErrors(2);
		expect(errors).toHaveLength(2);
	});

	it("tracks byHour histogram", async () => {
		const kv = createMockKV();
		const analyzer = createDLQAnalyzer<UserEvent>({ namespace: kv });

		const msg = createMockMessage<UserEvent>({ type: "created", userId: "1" });
		await analyzer.record(msg as any, createMetadata({ messageId: msg.id }), new Error("fail"));

		const summary = await analyzer.summary();
		// Should have at least one hour bucket
		const hourKeys = Object.keys(summary.byHour);
		expect(hourKeys.length).toBeGreaterThan(0);

		// The current hour bucket should have 1 failure
		const hourValues = Object.values(summary.byHour);
		expect(hourValues.some((v) => v === 1)).toBe(true);
	});

	it("tracks byQueue breakdown", async () => {
		const kv = createMockKV();
		const analyzer = createDLQAnalyzer<UserEvent>({ namespace: kv });

		const msg1 = createMockMessage<UserEvent>({ type: "created", userId: "1" });
		await analyzer.record(
			msg1 as any,
			createMetadata({ messageId: msg1.id, queue: "queue-a" }),
			new Error("fail"),
		);

		const msg2 = createMockMessage<UserEvent>({ type: "updated", userId: "2" });
		await analyzer.record(
			msg2 as any,
			createMetadata({ messageId: msg2.id, queue: "queue-a" }),
			new Error("fail"),
		);

		const msg3 = createMockMessage<UserEvent>({ type: "created", userId: "3" });
		await analyzer.record(
			msg3 as any,
			createMetadata({ messageId: msg3.id, queue: "queue-b" }),
			new Error("fail"),
		);

		const summary = await analyzer.summary();
		expect(summary.byQueue["queue-a"]).toBe(2);
		expect(summary.byQueue["queue-b"]).toBe(1);
	});

	it("stores sample message IDs in error patterns", async () => {
		const kv = createMockKV();
		const analyzer = createDLQAnalyzer<UserEvent>({ namespace: kv });

		const msg = createMockMessage<UserEvent>({ type: "created", userId: "1" });
		await analyzer.record(msg as any, createMetadata({ messageId: msg.id }), new Error("timeout"));

		const errors = await analyzer.topErrors();
		expect(errors[0].sampleMessageIds).toContain(msg.id);
	});

	it("uses custom prefix for KV keys", async () => {
		const kv = createMockKV();
		const analyzer = createDLQAnalyzer<UserEvent>({
			namespace: kv,
			prefix: "my-app",
		});

		const msg = createMockMessage<UserEvent>({ type: "created", userId: "1" });
		await analyzer.record(msg as any, createMetadata({ messageId: msg.id }), new Error("fail"));

		// Verify KV keys use the prefix
		const keys = [...kv._store.keys()];
		expect(keys.some((k) => k.startsWith("dlq:my-app:"))).toBe(true);
	});

	it("records without error (unknown error)", async () => {
		const kv = createMockKV();
		const analyzer = createDLQAnalyzer<UserEvent>({ namespace: kv });

		const msg = createMockMessage<UserEvent>({ type: "created", userId: "1" });
		await analyzer.record(msg as any, createMetadata({ messageId: msg.id }));

		const summary = await analyzer.summary();
		expect(summary.total).toBe(1);

		const errors = await analyzer.topErrors();
		expect(errors[0].message).toBe("unknown");
	});

	it("includes topErrors in summary", async () => {
		const kv = createMockKV();
		const analyzer = createDLQAnalyzer<UserEvent>({ namespace: kv });

		const msg = createMockMessage<UserEvent>({ type: "created", userId: "1" });
		await analyzer.record(msg as any, createMetadata({ messageId: msg.id }), new Error("boom"));

		const summary = await analyzer.summary();
		expect(summary.topErrors).toHaveLength(1);
		expect(summary.topErrors[0].message).toBe("boom");
	});
});
