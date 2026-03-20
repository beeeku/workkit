import { describe, expect, it } from "vitest";
import { executeGenDocs, extractPathParams, routesToOpenAPI } from "../src/commands/gen-docs";
import { createMockFs } from "./helpers";

describe("gen docs command", () => {
	describe("routesToOpenAPI", () => {
		it("generates valid OpenAPI 3.1 spec", () => {
			const routes = [{ method: "GET", path: "/health", name: "getHealth" }];
			const spec = routesToOpenAPI(routes, "Test API", "1.0.0");
			expect(spec.openapi).toBe("3.1.0");
			expect(spec.info.title).toBe("Test API");
			expect(spec.info.version).toBe("1.0.0");
		});

		it("creates path entries for each route", () => {
			const routes = [
				{ method: "GET", path: "/health", name: "getHealth" },
				{ method: "POST", path: "/users", name: "createUsers" },
			];
			const spec = routesToOpenAPI(routes, "API", "1.0.0");
			expect(spec.paths["/health"]).toBeDefined();
			expect(spec.paths["/users"]).toBeDefined();
			expect(spec.paths["/health"]!.get).toBeDefined();
			expect(spec.paths["/users"]!.post).toBeDefined();
		});

		it("converts path params to OpenAPI format", () => {
			const routes = [{ method: "GET", path: "/users/:id", name: "getUser" }];
			const spec = routesToOpenAPI(routes, "API", "1.0.0");
			expect(spec.paths["/users/{id}"]).toBeDefined();
		});

		it("includes requestBody for POST/PUT/PATCH", () => {
			const routes = [{ method: "POST", path: "/users", name: "createUsers" }];
			const spec = routesToOpenAPI(routes, "API", "1.0.0");
			expect(spec.paths["/users"]!.post!.requestBody).toBeDefined();
		});

		it("excludes requestBody for GET/DELETE", () => {
			const routes = [{ method: "GET", path: "/users", name: "getUsers" }];
			const spec = routesToOpenAPI(routes, "API", "1.0.0");
			expect(spec.paths["/users"]!.get!.requestBody).toBeUndefined();
		});

		it("sets operationId from route name", () => {
			const routes = [{ method: "GET", path: "/health", name: "getHealth" }];
			const spec = routesToOpenAPI(routes, "API", "1.0.0");
			expect(spec.paths["/health"]!.get!.operationId).toBe("getHealth");
		});

		it("groups multiple methods under same path", () => {
			const routes = [
				{ method: "GET", path: "/users", name: "getUsers" },
				{ method: "POST", path: "/users", name: "createUsers" },
			];
			const spec = routesToOpenAPI(routes, "API", "1.0.0");
			expect(spec.paths["/users"]!.get).toBeDefined();
			expect(spec.paths["/users"]!.post).toBeDefined();
		});
	});

	describe("extractPathParams", () => {
		it("extracts parameters from path", () => {
			expect(extractPathParams("/users/:id")).toEqual(["id"]);
		});

		it("extracts multiple parameters", () => {
			expect(extractPathParams("/users/:userId/posts/:postId")).toEqual(["userId", "postId"]);
		});

		it("returns empty for paths without params", () => {
			expect(extractPathParams("/users")).toEqual([]);
		});
	});

	describe("executeGenDocs", () => {
		it("generates OpenAPI spec from source", async () => {
			const fs = createMockFs({
				"/src/api/routes.ts": `app.get('/health', h)\napp.post('/users', h)`,
			});
			const spec = await executeGenDocs(
				{ sourceDir: "/src/api", output: "/docs/openapi.json", title: "My API", version: "2.0.0" },
				fs,
			);
			expect(spec.info.title).toBe("My API");
			expect(spec.info.version).toBe("2.0.0");
			expect(fs.files.has("/docs/openapi.json")).toBe(true);
		});

		it("throws for missing source directory", async () => {
			const fs = createMockFs();
			await expect(
				executeGenDocs({ sourceDir: "/missing", output: "/out.json" }, fs),
			).rejects.toThrow("not found");
		});

		it("uses defaults for title and version", async () => {
			const fs = createMockFs({
				"/src/routes.ts": `app.get('/x', h)`,
			});
			const spec = await executeGenDocs({ sourceDir: "/src", output: "/out.json" }, fs);
			expect(spec.info.title).toBe("API");
			expect(spec.info.version).toBe("0.0.1");
		});
	});
});
