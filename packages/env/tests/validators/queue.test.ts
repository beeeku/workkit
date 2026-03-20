import { describe, expect, it } from "vitest";
import { queue } from "../../src/validators/queue";

function mockQueue() {
	return { send: () => {}, sendBatch: () => {} };
}

describe("queue()", () => {
	it("returns a valid StandardSchemaV1 object", () => {
		const v = queue();
		expect(v["~standard"].version).toBe(1);
		expect(v["~standard"].vendor).toBe("workkit");
	});

	it("accepts a Queue-shaped object", () => {
		const mock = mockQueue();
		const result = queue()["~standard"].validate(mock);
		expect("value" in result).toBe(true);
	});

	it("rejects undefined", () => {
		expect("issues" in queue()["~standard"].validate(undefined)).toBe(true);
	});

	it("rejects objects missing Queue methods", () => {
		expect("issues" in queue()["~standard"].validate({ send: () => {} })).toBe(true);
	});

	it("returns error with wrangler.toml hint", () => {
		const result = queue()["~standard"].validate(undefined);
		const issues = (result as any).issues;
		expect(issues[0].message).toContain("Queue");
		expect(issues[0].message).toContain("[[queues.producers]]");
	});

	it("uses custom message", () => {
		const result = queue({ message: "Custom" })["~standard"].validate(undefined);
		expect((result as any).issues[0].message).toBe("Custom");
	});
});
