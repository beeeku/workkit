import { EnvValidationError } from "@workkit/env";
import {
	ConfigError,
	ConflictError,
	ForbiddenError,
	InternalError,
	NotFoundError,
	RateLimitError,
	ServiceUnavailableError,
	TimeoutError,
	UnauthorizedError,
	ValidationError,
} from "@workkit/errors";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { workkitErrorHandler } from "../src/error-handler";

function createApp() {
	const app = new Hono();
	app.onError(workkitErrorHandler());
	return app;
}

describe("workkitErrorHandler", () => {
	describe("WorkkitError → HTTP response mapping", () => {
		it("converts NotFoundError to 404", async () => {
			const app = createApp();
			app.get("/", () => {
				throw new NotFoundError("User", "123");
			});

			const res = await app.request("/");
			expect(res.status).toBe(404);

			const body = await res.json();
			expect(body.error.code).toBe("WORKKIT_NOT_FOUND");
			expect(body.error.message).toContain("User");
			expect(body.error.message).toContain("123");
		});

		it("converts ValidationError to 400", async () => {
			const app = createApp();
			app.get("/", () => {
				throw new ValidationError("Invalid input", [{ path: ["name"], message: "Required" }]);
			});

			const res = await app.request("/");
			expect(res.status).toBe(400);

			const body = await res.json();
			expect(body.error.code).toBe("WORKKIT_VALIDATION");
			expect(body.error.issues).toHaveLength(1);
			expect(body.error.issues[0].message).toBe("Required");
		});

		it("converts UnauthorizedError to 401", async () => {
			const app = createApp();
			app.get("/", () => {
				throw new UnauthorizedError();
			});

			const res = await app.request("/");
			expect(res.status).toBe(401);

			const body = await res.json();
			expect(body.error.code).toBe("WORKKIT_UNAUTHORIZED");
		});

		it("converts ForbiddenError to 403", async () => {
			const app = createApp();
			app.get("/", () => {
				throw new ForbiddenError();
			});

			const res = await app.request("/");
			expect(res.status).toBe(403);

			const body = await res.json();
			expect(body.error.code).toBe("WORKKIT_FORBIDDEN");
		});

		it("converts RateLimitError to 429", async () => {
			const app = createApp();
			app.get("/", () => {
				throw new RateLimitError("Too many requests", 5000);
			});

			const res = await app.request("/");
			expect(res.status).toBe(429);

			const body = await res.json();
			expect(body.error.code).toBe("WORKKIT_RATE_LIMIT");
			expect(res.headers.get("Retry-After")).toBe("5");
		});

		it("converts RateLimitError without retryAfterMs (no Retry-After header)", async () => {
			const app = createApp();
			app.get("/", () => {
				throw new RateLimitError();
			});

			const res = await app.request("/");
			expect(res.status).toBe(429);
			expect(res.headers.get("Retry-After")).toBeNull();
		});

		it("converts TimeoutError to 504", async () => {
			const app = createApp();
			app.get("/", () => {
				throw new TimeoutError("Database query", 30000);
			});

			const res = await app.request("/");
			expect(res.status).toBe(504);

			const body = await res.json();
			expect(body.error.code).toBe("WORKKIT_TIMEOUT");
		});

		it("converts ServiceUnavailableError to 503", async () => {
			const app = createApp();
			app.get("/", () => {
				throw new ServiceUnavailableError("Payment service");
			});

			const res = await app.request("/");
			expect(res.status).toBe(503);

			const body = await res.json();
			expect(body.error.code).toBe("WORKKIT_SERVICE_UNAVAILABLE");
		});

		it("converts ConflictError to 409", async () => {
			const app = createApp();
			app.get("/", () => {
				throw new ConflictError("Resource already exists");
			});

			const res = await app.request("/");
			expect(res.status).toBe(409);

			const body = await res.json();
			expect(body.error.code).toBe("WORKKIT_CONFLICT");
		});

		it("converts InternalError to 500", async () => {
			const app = createApp();
			app.get("/", () => {
				throw new InternalError("Something went wrong");
			});

			const res = await app.request("/");
			expect(res.status).toBe(500);

			const body = await res.json();
			expect(body.error.code).toBe("WORKKIT_INTERNAL");
		});

		it("converts ConfigError to 500", async () => {
			const app = createApp();
			app.get("/", () => {
				throw new ConfigError("Missing configuration");
			});

			const res = await app.request("/");
			expect(res.status).toBe(500);

			const body = await res.json();
			expect(body.error.code).toBe("WORKKIT_CONFIG");
		});

		it("converts EnvValidationError to 400 with issues", async () => {
			const app = createApp();
			app.get("/", () => {
				throw new EnvValidationError([
					{ key: "API_KEY", message: "Required" },
					{ key: "DB_URL", message: "Invalid format", received: "bad" },
				]);
			});

			const res = await app.request("/");
			expect(res.status).toBe(400);

			const body = await res.json();
			expect(body.error.code).toBe("WORKKIT_VALIDATION");
			expect(body.error.issues).toHaveLength(2);
		});
	});

	describe("unknown errors", () => {
		it("wraps unknown Error as 500 InternalError", async () => {
			const app = createApp();
			app.get("/", () => {
				throw new Error("random failure");
			});

			const res = await app.request("/");
			expect(res.status).toBe(500);

			const body = await res.json();
			expect(body.error.code).toBe("WORKKIT_INTERNAL");
			expect(body.error.message).toBe("random failure");
		});

		it("wraps TypeError as 500 InternalError", async () => {
			const app = createApp();
			app.get("/", () => {
				const obj: any = null;
				obj.nonExistent(); // throws TypeError
			});

			const res = await app.request("/");
			expect(res.status).toBe(500);

			const body = await res.json();
			expect(body.error.code).toBe("WORKKIT_INTERNAL");
		});
	});

	describe("options", () => {
		it("includes stack trace when includeStack is true", async () => {
			const app = new Hono();
			app.onError(workkitErrorHandler({ includeStack: true }));
			app.get("/", () => {
				throw new InternalError("debug me");
			});

			const res = await app.request("/");
			const body = await res.json();
			expect(body.error.stack).toBeDefined();
			expect(body.error.stack).toContain("InternalError");
		});

		it("excludes stack trace by default", async () => {
			const app = createApp();
			app.get("/", () => {
				throw new InternalError("production error");
			});

			const res = await app.request("/");
			const body = await res.json();
			expect(body.error.stack).toBeUndefined();
		});

		it("calls onError callback", async () => {
			const onError = vi.fn();
			const app = new Hono();
			app.onError(workkitErrorHandler({ onError }));
			app.get("/", () => {
				throw new NotFoundError("Thing");
			});

			await app.request("/");
			expect(onError).toHaveBeenCalledOnce();
			expect(onError.mock.calls[0]![0]).toBeInstanceOf(NotFoundError);
		});

		it("does not break response if onError callback throws", async () => {
			const onError = vi.fn(() => {
				throw new Error("callback failed");
			});
			const app = new Hono();
			app.onError(workkitErrorHandler({ onError }));
			app.get("/", () => {
				throw new NotFoundError("Thing");
			});

			const res = await app.request("/");
			expect(res.status).toBe(404);
		});
	});

	describe("response format", () => {
		it("returns JSON content type", async () => {
			const app = createApp();
			app.get("/", () => {
				throw new InternalError("test");
			});

			const res = await app.request("/");
			expect(res.headers.get("Content-Type")).toBe("application/json");
		});

		it("returns proper error body structure", async () => {
			const app = createApp();
			app.get("/", () => {
				throw new NotFoundError("Widget", "abc-123");
			});

			const res = await app.request("/");
			const body = await res.json();

			expect(body).toHaveProperty("error");
			expect(body.error).toHaveProperty("code");
			expect(body.error).toHaveProperty("message");
			expect(body.error).toHaveProperty("statusCode");
			expect(body.error.statusCode).toBe(404);
		});
	});
});
