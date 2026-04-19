import { describe, expect, it, vi } from "vitest";
import { StructuredRetryExhaustedError, structuredWithRetry } from "../src/structured";

// ─── Hand-written Standard Schema stub ─────────────────────────
//
// Accepts `{ name: string; age: number }`. Returns issues otherwise. We hand-
// roll one instead of pulling in Zod so the test stays dep-free and the
// structural contract we rely on is obvious.

interface Person {
	name: string;
	age: number;
}

const personSchema = {
	"~standard": {
		version: 1 as const,
		vendor: "test",
		validate(value: unknown) {
			if (
				value &&
				typeof value === "object" &&
				typeof (value as { name?: unknown }).name === "string" &&
				typeof (value as { age?: unknown }).age === "number"
			) {
				return { value: value as Person };
			}
			return {
				issues: [{ message: "expected { name: string; age: number }" }],
			};
		},
	},
};

// ─── Tests ─────────────────────────────────────────────────────

describe("structuredWithRetry", () => {
	it("returns on clean first attempt and does not fire onAttempt", async () => {
		const onAttempt = vi.fn();
		const generate = vi.fn().mockResolvedValue({
			text: JSON.stringify({ name: "Alice", age: 30 }),
			raw: { provider: "test" },
		});

		const result = await structuredWithRetry<Person>({
			schema: personSchema,
			generate,
			maxAttempts: 3,
			onAttempt,
		});

		expect(result.value).toEqual({ name: "Alice", age: 30 });
		expect(result.attempts).toBe(1);
		expect(result.raw).toEqual({ provider: "test" });
		expect(generate).toHaveBeenCalledTimes(1);
		expect(generate).toHaveBeenNthCalledWith(1, undefined);
		expect(onAttempt).not.toHaveBeenCalled();
	});

	it("reprompts once on bad JSON and returns attempts: 2 with onAttempt fired once", async () => {
		const onAttempt = vi.fn();
		const generate = vi
			.fn()
			.mockResolvedValueOnce({ text: "not valid json at all", raw: null })
			.mockResolvedValueOnce({
				text: JSON.stringify({ name: "Bob", age: 42 }),
				raw: { ok: true },
			});

		const result = await structuredWithRetry<Person>({
			schema: personSchema,
			generate,
			maxAttempts: 3,
			onAttempt,
		});

		expect(result.value).toEqual({ name: "Bob", age: 42 });
		expect(result.attempts).toBe(2);
		expect(generate).toHaveBeenCalledTimes(2);
		expect(onAttempt).toHaveBeenCalledTimes(1);
		expect(onAttempt.mock.calls[0][0]).toBe(2);
		expect(onAttempt.mock.calls[0][1]).toBeInstanceOf(Error);
	});

	it("exhausts after maxAttempts: 3 and throws StructuredRetryExhaustedError", async () => {
		const generate = vi.fn().mockResolvedValue({
			text: JSON.stringify({ wrongShape: true }),
			raw: { attempt: "bad" },
		});

		await expect(
			structuredWithRetry<Person>({
				schema: personSchema,
				generate,
				maxAttempts: 3,
			}),
		).rejects.toMatchObject({
			name: "StructuredRetryExhaustedError",
			attempts: 3,
		});

		expect(generate).toHaveBeenCalledTimes(3);
	});

	it("passes the actual parse error to onAttempt", async () => {
		const onAttempt = vi.fn();
		const generate = vi
			.fn()
			.mockResolvedValueOnce({
				text: JSON.stringify({ wrongShape: true }),
				raw: null,
			})
			.mockResolvedValueOnce({
				text: JSON.stringify({ name: "Carol", age: 7 }),
				raw: null,
			});

		await structuredWithRetry<Person>({
			schema: personSchema,
			generate,
			maxAttempts: 3,
			onAttempt,
		});

		expect(onAttempt).toHaveBeenCalledTimes(1);
		const [attemptNum, err] = onAttempt.mock.calls[0];
		expect(attemptNum).toBe(2);
		expect(err).toBeInstanceOf(Error);
		expect((err as Error).message).toContain("expected { name: string; age: number }");
	});

	it("propagates non-parse errors from generate without retrying", async () => {
		const onAttempt = vi.fn();
		const networkErr = new Error("network down");
		const generate = vi.fn().mockRejectedValue(networkErr);

		await expect(
			structuredWithRetry<Person>({
				schema: personSchema,
				generate,
				maxAttempts: 5,
				onAttempt,
			}),
		).rejects.toBe(networkErr);

		expect(generate).toHaveBeenCalledTimes(1);
		expect(onAttempt).not.toHaveBeenCalled();
	});

	it("throws StructuredRetryExhaustedError with maxAttempts: 1 and bad output (no retry)", async () => {
		const onAttempt = vi.fn();
		const generate = vi.fn().mockResolvedValue({
			text: "not json",
			raw: { last: true },
		});

		let caught: unknown;
		try {
			await structuredWithRetry<Person>({
				schema: personSchema,
				generate,
				maxAttempts: 1,
				onAttempt,
			});
		} catch (err) {
			caught = err;
		}

		expect(caught).toBeInstanceOf(StructuredRetryExhaustedError);
		expect((caught as StructuredRetryExhaustedError).attempts).toBe(1);
		expect((caught as StructuredRetryExhaustedError).lastRaw).toEqual({
			last: true,
		});
		expect((caught as StructuredRetryExhaustedError).lastError).toBeInstanceOf(Error);
		expect(generate).toHaveBeenCalledTimes(1);
		expect(onAttempt).not.toHaveBeenCalled();
	});

	it("threads the prior parse error's .message into the remindWith arg on attempt 2", async () => {
		const generate = vi
			.fn()
			.mockResolvedValueOnce({
				text: JSON.stringify({ wrongShape: true }),
				raw: null,
			})
			.mockResolvedValueOnce({
				text: JSON.stringify({ name: "Dave", age: 99 }),
				raw: null,
			});

		await structuredWithRetry<Person>({
			schema: personSchema,
			generate,
			maxAttempts: 3,
		});

		expect(generate).toHaveBeenCalledTimes(2);
		// First call: remindWith = undefined
		expect(generate).toHaveBeenNthCalledWith(1, undefined);
		// Second call: remindWith = the prior parse error's .message
		const secondArg = generate.mock.calls[1][0];
		expect(typeof secondArg).toBe("string");
		expect(secondArg).toContain("expected { name: string; age: number }");
	});
});
