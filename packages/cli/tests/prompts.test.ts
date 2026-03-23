import { describe, expect, it } from "vitest";
import { validateProjectName } from "../src/prompts/project-name";

describe("prompt utilities", () => {
	describe("validateProjectName", () => {
		it("accepts valid npm package names", () => {
			expect(validateProjectName("my-app")).toBeUndefined();
			expect(validateProjectName("my_app")).toBeUndefined();
			expect(validateProjectName("app123")).toBeUndefined();
		});

		it("rejects empty names", () => {
			expect(validateProjectName("")).toBe("Project name is required");
		});

		it("rejects names with spaces", () => {
			expect(validateProjectName("my app")).toBe("Project name cannot contain spaces");
		});

		it("rejects names starting with dot or underscore", () => {
			expect(validateProjectName(".hidden")).toBe("Project name cannot start with . or _");
			expect(validateProjectName("_private")).toBe("Project name cannot start with . or _");
		});
	});
});
