import { describe, expect, it } from "vitest";
import { createLoader } from "../src/loader";
import { createMockLoaderArgs, createNumberValidator, createStringValidator } from "./helpers";

describe("createLoader", () => {
	describe("without env validation", () => {
		it("should call handler and return JSON response", async () => {
			const loader = createLoader(async ({ params }) => {
				return { id: params.id };
			});

			const args = createMockLoaderArgs({ params: { id: "123" } });
			const response = await loader(args);

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("application/json");
			expect(await response.json()).toEqual({ id: "123" });
		});

		it("should pass raw env to handler", async () => {
			const loader = createLoader(async ({ env }) => {
				return { key: env.API_KEY };
			});

			const args = createMockLoaderArgs({ env: { API_KEY: "test-key" } });
			const response = await loader(args);
			expect(await response.json()).toEqual({ key: "test-key" });
		});

		it("should pass request to handler", async () => {
			const loader = createLoader(async ({ request }) => {
				return { url: request.url };
			});

			const args = createMockLoaderArgs({ url: "https://example.com/users" });
			const response = await loader(args);
			expect(await response.json()).toEqual({ url: "https://example.com/users" });
		});

		it("should pass context to handler", async () => {
			const loader = createLoader(async ({ context }) => {
				return { hasCloudflare: !!context.cloudflare };
			});

			const args = createMockLoaderArgs();
			const response = await loader(args);
			expect(await response.json()).toEqual({ hasCloudflare: true });
		});

		it("should pass through Response objects unchanged", async () => {
			const loader = createLoader(async () => {
				return new Response("custom", { status: 201, headers: { "X-Custom": "yes" } });
			});

			const args = createMockLoaderArgs();
			const response = await loader(args);

			expect(response.status).toBe(201);
			expect(response.headers.get("x-custom")).toBe("yes");
			expect(await response.text()).toBe("custom");
		});

		it("should propagate errors from handler", async () => {
			const loader = createLoader(async () => {
				throw new Error("Loader failed");
			});

			const args = createMockLoaderArgs();
			await expect(loader(args)).rejects.toThrow("Loader failed");
		});

		it("should propagate Response throws", async () => {
			const loader = createLoader(async () => {
				throw new Response("Not Found", { status: 404 });
			});

			const args = createMockLoaderArgs();
			await expect(loader(args)).rejects.toBeInstanceOf(Response);
		});
	});

	describe("with env validation", () => {
		it("should validate and type env from context", async () => {
			const loader = createLoader(
				{ env: { API_KEY: createStringValidator({ min: 1 }) } },
				async ({ env }) => {
					return { key: env.API_KEY };
				},
			);

			const args = createMockLoaderArgs({ env: { API_KEY: "my-key" } });
			const response = await loader(args);
			expect(await response.json()).toEqual({ key: "my-key" });
		});

		it("should throw on invalid env", async () => {
			const loader = createLoader(
				{ env: { API_KEY: createStringValidator({ min: 1 }) } },
				async ({ env }) => {
					return { key: env.API_KEY };
				},
			);

			const args = createMockLoaderArgs({ env: { API_KEY: "" } });
			await expect(loader(args)).rejects.toThrow();
		});

		it("should throw on missing env binding", async () => {
			const loader = createLoader(
				{ env: { API_KEY: createStringValidator() } },
				async ({ env }) => {
					return { key: env.API_KEY };
				},
			);

			const args = createMockLoaderArgs({ env: {} });
			await expect(loader(args)).rejects.toThrow();
		});

		it("should validate multiple env bindings", async () => {
			const loader = createLoader(
				{
					env: {
						API_KEY: createStringValidator({ min: 1 }),
						PORT: createNumberValidator({ min: 1 }),
					},
				},
				async ({ env }) => {
					return { key: env.API_KEY, port: env.PORT };
				},
			);

			const args = createMockLoaderArgs({ env: { API_KEY: "key", PORT: 8080 } });
			const response = await loader(args);
			expect(await response.json()).toEqual({ key: "key", port: 8080 });
		});

		it("should cache env validation across calls with same context", async () => {
			let validateCount = 0;
			const countingValidator = {
				"~standard": {
					version: 1 as const,
					vendor: "test" as const,
					validate: (value: unknown) => {
						validateCount++;
						return { value };
					},
				},
			};

			const loader = createLoader({ env: { KEY: countingValidator } }, async ({ env }) => {
				return { key: env.KEY };
			});

			const args = createMockLoaderArgs({ env: { KEY: "val" } });
			await loader(args);
			// Call again with same args (same context object)
			await loader(args);

			// Validation should only happen once due to WeakMap caching
			expect(validateCount).toBe(1);
		});
	});

	describe("serialization", () => {
		it("should serialize null as JSON", async () => {
			const loader = createLoader(async () => null);

			const args = createMockLoaderArgs();
			const response = await loader(args);
			expect(await response.json()).toBe(null);
		});

		it("should serialize arrays as JSON", async () => {
			const loader = createLoader(async () => [1, 2, 3]);

			const args = createMockLoaderArgs();
			const response = await loader(args);
			expect(await response.json()).toEqual([1, 2, 3]);
		});

		it("should serialize nested objects", async () => {
			const loader = createLoader(async () => ({
				user: { name: "Alice", roles: ["admin"] },
			}));

			const args = createMockLoaderArgs();
			const response = await loader(args);
			expect(await response.json()).toEqual({
				user: { name: "Alice", roles: ["admin"] },
			});
		});
	});
});
