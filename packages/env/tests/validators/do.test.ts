import { describe, expect, it } from "vitest";
import { durableObject } from "../../src/validators/do";

function mockDO() {
	return { get: () => {}, idFromName: () => {}, idFromString: () => {} };
}

describe("durableObject()", () => {
	it("returns a valid StandardSchemaV1 object", () => {
		const v = durableObject();
		expect(v["~standard"].version).toBe(1);
		expect(v["~standard"].vendor).toBe("workkit");
	});

	it("accepts a DurableObjectNamespace-shaped object", () => {
		const mock = mockDO();
		const result = durableObject()["~standard"].validate(mock);
		expect("value" in result).toBe(true);
	});

	it("rejects undefined", () => {
		expect("issues" in durableObject()["~standard"].validate(undefined)).toBe(true);
	});

	it("rejects objects missing DO methods", () => {
		expect("issues" in durableObject()["~standard"].validate({ get: () => {} })).toBe(true);
	});

	it("returns error with wrangler.toml hint", () => {
		const result = durableObject()["~standard"].validate(undefined);
		const issues = (result as any).issues;
		expect(issues[0].message).toContain("DurableObjectNamespace");
		expect(issues[0].message).toContain("[durable_objects]");
	});

	it("uses custom message", () => {
		const result = durableObject({ message: "Custom" })["~standard"].validate(undefined);
		expect((result as any).issues[0].message).toBe("Custom");
	});
});
