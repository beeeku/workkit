import {
	D1BatchError,
	D1ConstraintError,
	D1Error,
	D1MigrationError,
	D1QueryError,
	classifyD1Error,
} from "@workkit/d1";
import {
	BindingError,
	BindingNotFoundError,
	ConfigError,
	ConflictError,
	ForbiddenError,
	InternalError,
	NotFoundError,
	RateLimitError,
	RetryStrategies,
	ServiceUnavailableError,
	TimeoutError,
	UnauthorizedError,
	ValidationError,
	WorkkitError,
	errorToResponse,
	fromHttpStatus,
	getRetryDelay,
	getRetryStrategy,
	isErrorCode,
	isRetryable,
	isWorkkitError,
	serializeError,
	wrapError,
} from "@workkit/errors";
import { describe, expect, it } from "vitest";

describe("Error propagation E2E", () => {
	describe("D1 errors include proper error codes", () => {
		it("D1QueryError has correct code and context", () => {
			const err = new D1QueryError("syntax error", "SELECT * FORM users", []);
			expect(err.code).toBe("WORKKIT_D1_QUERY");
			expect(err.statusCode).toBe(500);
			expect(err.sql).toBe("SELECT * FORM users");
			expect(err.message).toContain("D1 query failed");
		});

		it("D1ConstraintError has correct code and type", () => {
			const err = new D1ConstraintError("UNIQUE constraint failed: users.email", "UNIQUE");
			expect(err.code).toBe("WORKKIT_D1_CONSTRAINT");
			expect(err.statusCode).toBe(409);
			expect(err.constraintType).toBe("UNIQUE");
			expect(err.retryable).toBe(true);
		});

		it("D1BatchError includes failed index", () => {
			const err = new D1BatchError("Statement 2 failed", 2);
			expect(err.code).toBe("WORKKIT_D1_BATCH");
			expect(err.failedIndex).toBe(2);
		});

		it("D1MigrationError includes migration name", () => {
			const err = new D1MigrationError("001_create_users", "Table already exists");
			expect(err.code).toBe("WORKKIT_D1_MIGRATION");
			expect(err.migrationName).toBe("001_create_users");
			expect(err.message).toContain("001_create_users");
		});

		it("classifyD1Error recognizes UNIQUE constraint", () => {
			const err = classifyD1Error(new Error("UNIQUE constraint failed: users.email"));
			expect(err).toBeInstanceOf(D1ConstraintError);
			expect((err as D1ConstraintError).constraintType).toBe("UNIQUE");
		});

		it("classifyD1Error recognizes NOT NULL constraint", () => {
			const err = classifyD1Error(new Error("NOT NULL constraint failed: users.name"));
			expect(err).toBeInstanceOf(D1ConstraintError);
			expect((err as D1ConstraintError).constraintType).toBe("NOT_NULL");
		});

		it("classifyD1Error recognizes no such table", () => {
			const err = classifyD1Error(new Error("no such table: posts"), "SELECT * FROM posts");
			expect(err).toBeInstanceOf(D1QueryError);
		});

		it("classifyD1Error falls back to D1Error for unknown errors", () => {
			const err = classifyD1Error(new Error("Something unexpected"));
			expect(err).toBeInstanceOf(D1Error);
		});
	});

	describe("Errors serialize/deserialize correctly", () => {
		it("NotFoundError serializes to JSON", () => {
			const err = new NotFoundError("User", "123");
			const json = err.toJSON();

			expect(json.code).toBe("WORKKIT_NOT_FOUND");
			expect(json.message).toBe('User "123" not found');
			expect(json.statusCode).toBe(404);
			expect(json.retryable).toBe(false);
			expect(json.timestamp).toBeDefined();
			expect(json.context).toEqual({ resource: "User", identifier: "123" });
		});

		it("ValidationError serializes with issues", () => {
			const err = new ValidationError("Invalid input", [
				{ path: ["name"], message: "Required" },
				{ path: ["email"], message: "Invalid format" },
			]);
			const json = err.toJSON();

			expect(json.code).toBe("WORKKIT_VALIDATION");
			expect(json.context?.issues).toHaveLength(2);
		});

		it("error with cause serializes cause", () => {
			const cause = new NotFoundError("User", "123");
			const err = new InternalError("Lookup failed", { cause });
			const json = err.toJSON();

			expect(json.cause).toBeDefined();
			expect(json.cause!.code).toBe("WORKKIT_NOT_FOUND");
		});

		it("serializeError handles WorkkitError", () => {
			const err = new TimeoutError("Database query", 5000);
			const serialized = serializeError(err);

			expect("code" in serialized).toBe(true);
			expect((serialized as any).code).toBe("WORKKIT_TIMEOUT");
		});

		it("serializeError handles native Error", () => {
			const err = new TypeError("Cannot read property");
			const serialized = serializeError(err);

			expect(serialized.name).toBe("TypeError");
			expect(serialized.message).toBe("Cannot read property");
		});

		it("serializeError handles non-Error values", () => {
			const serialized = serializeError("string error");
			expect(serialized.message).toBe("string error");
		});

		it("toString includes code and context", () => {
			const err = new NotFoundError("User", "123");
			const str = err.toString();

			expect(str).toContain("WORKKIT_NOT_FOUND");
			expect(str).toContain("NotFoundError");
		});
	});

	describe("isRetryable classification works", () => {
		it("NotFoundError is not retryable", () => {
			expect(isRetryable(new NotFoundError("X"))).toBe(false);
		});

		it("ValidationError is not retryable", () => {
			expect(isRetryable(new ValidationError("bad"))).toBe(false);
		});

		it("UnauthorizedError is not retryable", () => {
			expect(isRetryable(new UnauthorizedError())).toBe(false);
		});

		it("ForbiddenError is not retryable", () => {
			expect(isRetryable(new ForbiddenError())).toBe(false);
		});

		it("TimeoutError is retryable", () => {
			expect(isRetryable(new TimeoutError("op"))).toBe(true);
		});

		it("RateLimitError is retryable", () => {
			expect(isRetryable(new RateLimitError())).toBe(true);
		});

		it("ServiceUnavailableError is retryable", () => {
			expect(isRetryable(new ServiceUnavailableError("svc"))).toBe(true);
		});

		it("ConflictError is retryable", () => {
			expect(isRetryable(new ConflictError("conflict"))).toBe(true);
		});

		it("D1ConstraintError is retryable", () => {
			expect(isRetryable(new D1ConstraintError("unique fail"))).toBe(true);
		});

		it("InternalError is not retryable", () => {
			expect(isRetryable(new InternalError("crash"))).toBe(false);
		});

		it("non-WorkkitError is not retryable", () => {
			expect(isRetryable(new Error("generic"))).toBe(false);
			expect(isRetryable("string")).toBe(false);
			expect(isRetryable(null)).toBe(false);
		});
	});

	describe("HTTP error helpers return correct status codes", () => {
		it("errorToResponse for NotFoundError", async () => {
			const err = new NotFoundError("User", "123");
			const res = errorToResponse(err);

			expect(res.status).toBe(404);
			const body = (await res.json()) as any;
			expect(body.error.code).toBe("WORKKIT_NOT_FOUND");
		});

		it("errorToResponse for ValidationError includes issues", async () => {
			const err = new ValidationError("Invalid", [{ path: ["name"], message: "Required" }]);
			const res = errorToResponse(err);

			expect(res.status).toBe(400);
			const body = (await res.json()) as any;
			expect(body.error.issues).toHaveLength(1);
		});

		it("errorToResponse for RateLimitError includes Retry-After header", () => {
			const err = new RateLimitError("Too many requests", 5000);
			const res = errorToResponse(err);

			expect(res.status).toBe(429);
			expect(res.headers.get("Retry-After")).toBe("5");
		});

		it("errorToResponse for UnauthorizedError", () => {
			const res = errorToResponse(new UnauthorizedError());
			expect(res.status).toBe(401);
		});

		it("errorToResponse for ForbiddenError", () => {
			const res = errorToResponse(new ForbiddenError());
			expect(res.status).toBe(403);
		});

		it("errorToResponse for TimeoutError", () => {
			const res = errorToResponse(new TimeoutError("DB query"));
			expect(res.status).toBe(504);
		});

		it("errorToResponse for ServiceUnavailableError", () => {
			const res = errorToResponse(new ServiceUnavailableError("API"));
			expect(res.status).toBe(503);
		});

		it("errorToResponse for InternalError", () => {
			const res = errorToResponse(new InternalError("crash"));
			expect(res.status).toBe(500);
		});

		it("fromHttpStatus creates correct errors", () => {
			expect(fromHttpStatus(400).statusCode).toBe(400);
			expect(fromHttpStatus(401).statusCode).toBe(401);
			expect(fromHttpStatus(403).statusCode).toBe(403);
			expect(fromHttpStatus(404).statusCode).toBe(404);
			expect(fromHttpStatus(429).statusCode).toBe(429);
			expect(fromHttpStatus(503).statusCode).toBe(503);
			expect(fromHttpStatus(504).statusCode).toBe(504);
			expect(fromHttpStatus(500).statusCode).toBe(500);
			expect(fromHttpStatus(502).statusCode).toBe(500); // generic 5xx
		});

		it("isWorkkitError type guard works", () => {
			expect(isWorkkitError(new NotFoundError("X"))).toBe(true);
			expect(isWorkkitError(new Error("generic"))).toBe(false);
			expect(isWorkkitError(null)).toBe(false);
		});

		it("isErrorCode checks specific codes", () => {
			const err = new NotFoundError("User");
			expect(isErrorCode(err, "WORKKIT_NOT_FOUND")).toBe(true);
			expect(isErrorCode(err, "WORKKIT_VALIDATION")).toBe(false);
		});
	});

	describe("Retry strategies", () => {
		it("none strategy always returns null", () => {
			const strategy = RetryStrategies.none();
			expect(getRetryDelay(strategy, 1)).toBeNull();
		});

		it("immediate strategy returns 0 delay", () => {
			const strategy = RetryStrategies.immediate(3);
			expect(getRetryDelay(strategy, 1)).toBe(0);
			expect(getRetryDelay(strategy, 2)).toBe(0);
			expect(getRetryDelay(strategy, 3)).toBe(0);
			expect(getRetryDelay(strategy, 4)).toBeNull();
		});

		it("fixed strategy returns constant delay", () => {
			const strategy = RetryStrategies.fixed(1000, 2);
			expect(getRetryDelay(strategy, 1)).toBe(1000);
			expect(getRetryDelay(strategy, 2)).toBe(1000);
			expect(getRetryDelay(strategy, 3)).toBeNull();
		});

		it("exponential strategy increases delay", () => {
			const strategy = RetryStrategies.exponential(100, 10000, 3);
			const d1 = getRetryDelay(strategy, 1)!;
			const d2 = getRetryDelay(strategy, 2)!;
			const d3 = getRetryDelay(strategy, 3)!;

			// With jitter, values are approximate
			expect(d1).toBeGreaterThanOrEqual(0);
			expect(d1).toBeLessThanOrEqual(150); // 100 * 2^0 + 25% jitter
			expect(d2).toBeGreaterThan(d1 * 0.5); // Generally increasing
			expect(d3).toBeGreaterThanOrEqual(0);
			expect(getRetryDelay(strategy, 4)).toBeNull();
		});

		it("getRetryStrategy returns none for non-workkit errors", () => {
			const strategy = getRetryStrategy(new Error("generic"));
			expect(strategy.kind).toBe("none");
		});

		it("getRetryStrategy returns error strategy for workkit errors", () => {
			const strategy = getRetryStrategy(new TimeoutError("op"));
			expect(strategy.kind).toBe("exponential");
		});

		it("override retry strategy takes precedence", () => {
			const err = new TimeoutError("op", undefined, {
				retryStrategy: RetryStrategies.fixed(500, 2),
			});
			expect(err.retryStrategy.kind).toBe("fixed");
		});
	});

	describe("wrapError utility", () => {
		it("passes through WorkkitError unchanged", () => {
			const original = new NotFoundError("User");
			const wrapped = wrapError(original);
			expect(wrapped).toBe(original);
		});

		it("wraps native Error as InternalError", () => {
			const wrapped = wrapError(new TypeError("bad"));
			expect(wrapped).toBeInstanceOf(InternalError);
			expect(wrapped.message).toBe("bad");
			expect(wrapped.cause).toBeInstanceOf(TypeError);
		});

		it("wraps string as InternalError", () => {
			const wrapped = wrapError("something broke");
			expect(wrapped).toBeInstanceOf(InternalError);
			expect(wrapped.message).toBe("something broke");
		});

		it("wraps with custom message", () => {
			const wrapped = wrapError(new Error("original"), "Custom context");
			expect(wrapped.message).toBe("Custom context");
		});
	});

	describe("Error hierarchy and instanceof", () => {
		it("all error classes extend WorkkitError", () => {
			expect(new NotFoundError("X")).toBeInstanceOf(WorkkitError);
			expect(new ConflictError("X")).toBeInstanceOf(WorkkitError);
			expect(new ValidationError("X")).toBeInstanceOf(WorkkitError);
			expect(new UnauthorizedError()).toBeInstanceOf(WorkkitError);
			expect(new ForbiddenError()).toBeInstanceOf(WorkkitError);
			expect(new TimeoutError("X")).toBeInstanceOf(WorkkitError);
			expect(new RateLimitError()).toBeInstanceOf(WorkkitError);
			expect(new ServiceUnavailableError("X")).toBeInstanceOf(WorkkitError);
			expect(new InternalError("X")).toBeInstanceOf(WorkkitError);
			expect(new ConfigError("X")).toBeInstanceOf(WorkkitError);
			expect(new BindingError("X")).toBeInstanceOf(WorkkitError);
			expect(new BindingNotFoundError("X")).toBeInstanceOf(WorkkitError);
		});

		it("all error classes extend Error", () => {
			expect(new NotFoundError("X")).toBeInstanceOf(Error);
			expect(new D1QueryError("X", "sql")).toBeInstanceOf(Error);
		});

		it("D1 errors extend WorkkitError", () => {
			expect(new D1Error("X")).toBeInstanceOf(WorkkitError);
			expect(new D1QueryError("X", "sql")).toBeInstanceOf(WorkkitError);
			expect(new D1ConstraintError("X")).toBeInstanceOf(WorkkitError);
			expect(new D1BatchError("X")).toBeInstanceOf(WorkkitError);
			expect(new D1MigrationError("m", "msg")).toBeInstanceOf(WorkkitError);
		});
	});
});
