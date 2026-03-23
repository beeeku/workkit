import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLogger, logger } from "../src/middleware";

describe("logger middleware", () => {
	let infoSpy: ReturnType<typeof vi.spyOn>;
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
		infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("logs request start and completion", async () => {
		const app = new Hono();
		app.use(logger());
		app.get("/test", (c) => c.text("ok"));

		await app.request("/test");

		expect(infoSpy).toHaveBeenCalledTimes(2);
		const start = JSON.parse(infoSpy.mock.calls[0]![0] as string);
		expect(start.msg).toBe("incoming request");
		expect(start.method).toBe("GET");
		expect(start.path).toBe("/test");
		expect(start.requestId).toBeDefined();

		const end = JSON.parse(infoSpy.mock.calls[1]![0] as string);
		expect(end.msg).toBe("request complete");
		expect(end.status).toBe(200);
		expect(end.duration).toBeDefined();
	});

	it("excludes routes from logging", async () => {
		const app = new Hono();
		app.use(logger({ exclude: ["/health"] }));
		app.get("/health", (c) => c.text("ok"));
		app.get("/api", (c) => c.text("data"));

		await app.request("/health");
		expect(infoSpy).not.toHaveBeenCalled();

		await app.request("/api");
		expect(infoSpy).toHaveBeenCalledTimes(2);
	});

	it("excludes routes with prefix matching", async () => {
		const app = new Hono();
		app.use(logger({ exclude: ["/internal/"] }));
		app.get("/internal/health", (c) => c.text("ok"));
		app.get("/internal/metrics", (c) => c.text("ok"));

		await app.request("/internal/health");
		await app.request("/internal/metrics");
		expect(infoSpy).not.toHaveBeenCalled();
	});

	it("includes base fields in log entries", async () => {
		const app = new Hono();
		app.use(logger({ fields: { service: "api", version: "1.0" } }));
		app.get("/", (c) => c.text("ok"));

		await app.request("/");

		const start = JSON.parse(infoSpy.mock.calls[0]![0] as string);
		expect(start.service).toBe("api");
		expect(start.version).toBe("1.0");
	});

	it("uses custom header for requestId", async () => {
		const app = new Hono();
		app.use(logger({ requestId: "x-request-id" }));
		app.get("/", (c) => c.text("ok"));

		await app.request("/", { headers: { "x-request-id": "custom-id-123" } });

		const start = JSON.parse(infoSpy.mock.calls[0]![0] as string);
		expect(start.requestId).toBe("custom-id-123");
	});

	it("auto-generates requestId when header missing", async () => {
		const app = new Hono();
		app.use(logger({ requestId: "x-request-id" }));
		app.get("/", (c) => c.text("ok"));

		await app.request("/");

		const start = JSON.parse(infoSpy.mock.calls[0]![0] as string);
		expect(start.requestId).toBeDefined();
		expect(start.requestId.length).toBeGreaterThan(0);
	});

	it("disables timing when timing: false", async () => {
		const app = new Hono();
		app.use(logger({ timing: false }));
		app.get("/", (c) => c.text("ok"));

		await app.request("/");

		// Only start log, no completion log
		expect(infoSpy).toHaveBeenCalledTimes(1);
		const start = JSON.parse(infoSpy.mock.calls[0]![0] as string);
		expect(start.msg).toBe("incoming request");
	});

	describe("getLogger", () => {
		it("returns a logger with request context", async () => {
			const app = new Hono();
			app.use(logger());
			app.get("/users", (c) => {
				const log = getLogger(c);
				log.info("custom message", { extra: "data" });
				return c.text("ok");
			});

			await app.request("/users");

			// start + custom + complete = 3 calls
			expect(infoSpy).toHaveBeenCalledTimes(3);
			const custom = JSON.parse(infoSpy.mock.calls[1]![0] as string);
			expect(custom.msg).toBe("custom message");
			expect(custom.extra).toBe("data");
			expect(custom.requestId).toBeDefined();
			expect(custom.method).toBe("GET");
			expect(custom.path).toBe("/users");
		});

		it("returns a fallback logger without middleware", async () => {
			const app = new Hono();
			app.get("/no-middleware", (c) => {
				const log = getLogger(c);
				log.info("still works");
				return c.text("ok");
			});

			await app.request("/no-middleware");
			expect(infoSpy).toHaveBeenCalledTimes(1);
		});

		it("child logger includes request context and child fields", async () => {
			const app = new Hono();
			app.use(logger());
			app.get("/users/:id", (c) => {
				const log = getLogger(c);
				const userLog = log.child({ userId: c.req.param("id") });
				userLog.info("loaded");
				return c.text("ok");
			});

			await app.request("/users/42");

			const custom = JSON.parse(infoSpy.mock.calls[1]![0] as string);
			expect(custom.userId).toBe("42");
			expect(custom.requestId).toBeDefined();
		});
	});
});
