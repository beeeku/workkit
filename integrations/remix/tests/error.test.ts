import {
	ForbiddenError,
	InternalError,
	NotFoundError,
	TimeoutError,
	UnauthorizedError,
	ValidationError,
} from "@workkit/errors";
import { describe, expect, it } from "vitest";
import { createErrorHandler } from "../src/error";

describe("createErrorHandler", () => {
	describe("WorkkitError handling", () => {
		it("should handle ValidationError with 400 status", async () => {
			const handleError = createErrorHandler();

			const error = new ValidationError("Bad input", [{ path: ["name"], message: "Required" }]);

			const response = await handleError(error);
			expect(response.status).toBe(400);

			const body = (await response.json()) as any;
			expect(body.error.code).toBe("WORKKIT_VALIDATION");
			expect(body.error.message).toBe("Bad input");
			expect(body.error.issues).toEqual([{ path: ["name"], message: "Required" }]);
		});

		it("should handle NotFoundError with 404 status", async () => {
			const handleError = createErrorHandler();

			const error = new NotFoundError("User", "42");
			const response = await handleError(error);

			expect(response.status).toBe(404);
			const body = (await response.json()) as any;
			expect(body.error.code).toBe("WORKKIT_NOT_FOUND");
		});

		it("should handle UnauthorizedError with 401 status", async () => {
			const handleError = createErrorHandler();

			const error = new UnauthorizedError("Token expired");
			const response = await handleError(error);

			expect(response.status).toBe(401);
			const body = (await response.json()) as any;
			expect(body.error.code).toBe("WORKKIT_UNAUTHORIZED");
		});

		it("should handle ForbiddenError with 403 status", async () => {
			const handleError = createErrorHandler();

			const error = new ForbiddenError("Insufficient permissions");
			const response = await handleError(error);

			expect(response.status).toBe(403);
			const body = (await response.json()) as any;
			expect(body.error.code).toBe("WORKKIT_FORBIDDEN");
		});

		it("should handle TimeoutError with 504 status", async () => {
			const handleError = createErrorHandler();

			const error = new TimeoutError("DB query");
			const response = await handleError(error);

			expect(response.status).toBe(504);
			const body = (await response.json()) as any;
			expect(body.error.code).toBe("WORKKIT_TIMEOUT");
		});

		it("should call onWorkkitError when provided", async () => {
			const handleError = createErrorHandler({
				onWorkkitError: (error) => {
					return new Response(`Custom: ${error.message}`, { status: error.statusCode });
				},
			});

			const error = new NotFoundError("User", "42");
			const response = await handleError(error);

			expect(response.status).toBe(404);
			expect(await response.text()).toBe('Custom: User "42" not found');
		});

		it("should set Content-Type to application/json", async () => {
			const handleError = createErrorHandler();

			const error = new InternalError("Oops");
			const response = await handleError(error);

			expect(response.headers.get("content-type")).toBe("application/json");
		});
	});

	describe("non-WorkkitError handling", () => {
		it("should wrap Error as InternalError with 500 status", async () => {
			const handleError = createErrorHandler();

			const error = new Error("Something broke");
			const response = await handleError(error);

			expect(response.status).toBe(500);
			const body = (await response.json()) as any;
			expect(body.error.code).toBe("WORKKIT_INTERNAL");
			expect(body.error.message).toBe("Something broke");
		});

		it("should call onError for non-WorkkitError", async () => {
			const handleError = createErrorHandler({
				onError: (error) => {
					return new Response(`Handled: ${error.message}`, { status: 500 });
				},
			});

			const error = new TypeError("Cannot read property");
			const response = await handleError(error);

			expect(response.status).toBe(500);
			expect(await response.text()).toBe("Handled: Cannot read property");
		});

		it("should handle string errors", async () => {
			const handleError = createErrorHandler();

			const response = await handleError("Something went wrong");

			expect(response.status).toBe(500);
			const body = (await response.json()) as any;
			expect(body.error.message).toBe("Something went wrong");
		});

		it("should handle null/undefined errors", async () => {
			const handleError = createErrorHandler();

			const response = await handleError(null);
			expect(response.status).toBe(500);

			const body = (await response.json()) as any;
			expect(body.error.message).toBe("An unexpected error occurred");
		});
	});

	describe("options", () => {
		it("should include stack when includeStack is true", async () => {
			const handleError = createErrorHandler({ includeStack: true });

			const error = new InternalError("Oops");
			const response = await handleError(error);

			const body = (await response.json()) as any;
			expect(body.error.stack).toBeDefined();
			expect(typeof body.error.stack).toBe("string");
		});

		it("should exclude stack when includeStack is false", async () => {
			const handleError = createErrorHandler({ includeStack: false });

			const error = new InternalError("Oops");
			const response = await handleError(error);

			const body = (await response.json()) as any;
			expect(body.error.stack).toBeUndefined();
		});

		it("should exclude stack by default", async () => {
			const handleError = createErrorHandler();

			const error = new InternalError("Oops");
			const response = await handleError(error);

			const body = (await response.json()) as any;
			expect(body.error.stack).toBeUndefined();
		});
	});
});
