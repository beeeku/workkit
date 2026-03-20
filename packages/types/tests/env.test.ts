import { describe, expect, it } from "vitest";

// The env.ts module is intentionally empty — env types live in @workkit/env.
// This test ensures the module can be imported without error and documents
// the intentional emptiness.
describe("env module", () => {
	it("module exists and can be imported", async () => {
		// Dynamic import to verify the module is resolvable
		const mod = await import("../src/env");
		expect(mod).toBeDefined();
		expect(Object.keys(mod)).toHaveLength(0);
	});
});
