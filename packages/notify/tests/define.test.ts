import { describe, expect, it } from "vitest";
import { z } from "zod";
import { define } from "../src/define";
import { NotifyConfigError, PayloadValidationError } from "../src/errors";
import type { DispatchJob } from "../src/types";

interface Captured {
	jobs: DispatchJob<unknown>[];
}

function fakeDeps(): { enqueue: (j: DispatchJob<unknown>) => Promise<void>; captured: Captured } {
	const captured: Captured = { jobs: [] };
	return {
		captured,
		enqueue: async (j) => {
			captured.jobs.push(j);
		},
	};
}

describe("notify.define()", () => {
	it("rejects an empty channels map", () => {
		const { enqueue } = fakeDeps();
		expect(() => define({ id: "n1", schema: z.object({}), channels: {} }, { enqueue })).toThrow(
			NotifyConfigError,
		);
	});

	it("rejects duplicate entries in fallback", () => {
		const { enqueue } = fakeDeps();
		expect(() =>
			define(
				{
					id: "n1",
					schema: z.object({}),
					channels: { email: {}, whatsapp: {} },
					fallback: ["email", "whatsapp", "email"],
				},
				{ enqueue },
			),
		).toThrow(NotifyConfigError);
	});

	it("rejects fallback channels missing from channels map", () => {
		const { enqueue } = fakeDeps();
		expect(() =>
			define(
				{
					id: "n1",
					schema: z.object({}),
					channels: { email: {} },
					fallback: ["email", "whatsapp"],
				},
				{ enqueue },
			),
		).toThrow(NotifyConfigError);
	});

	it("validates payload via Standard Schema before enqueue", async () => {
		const { enqueue, captured } = fakeDeps();
		const n = define(
			{
				id: "n1",
				schema: z.object({ symbol: z.string() }),
				channels: { email: {} },
			},
			{ enqueue },
		);
		await expect(
			(n.send as (p: unknown, t: { userId: string }) => Promise<unknown>)(
				{ symbol: 42 },
				{ userId: "u" },
			),
		).rejects.toBeInstanceOf(PayloadValidationError);
		expect(captured.jobs).toHaveLength(0);
	});

	it("enqueues a DispatchJob with a deterministic idempotencyKey", async () => {
		const { enqueue, captured } = fakeDeps();
		const n = define(
			{
				id: "n1",
				schema: z.object({ symbol: z.string() }),
				channels: { email: {} },
			},
			{ enqueue },
		);
		const r1 = await n.send({ symbol: "NIFTY" }, { userId: "u1" });
		const r2 = await n.send({ symbol: "NIFTY" }, { userId: "u1" });
		expect(r1.idempotencyKey).toBe(r2.idempotencyKey);
		expect(captured.jobs).toHaveLength(2); // both enqueued; dispatcher will dedup
	});

	it("respects an explicit idempotencyKey override", async () => {
		const { enqueue } = fakeDeps();
		const n = define({ id: "n1", schema: z.object({}), channels: { email: {} } }, { enqueue });
		const r = await n.send({}, { userId: "u" }, { idempotencyKey: "custom" });
		expect(r.idempotencyKey).toBe("custom");
	});
});
