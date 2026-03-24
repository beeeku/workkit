import { describe, expect, it } from "vitest";
import { DeliveryError, InvalidAddressError, MailError } from "../src/errors";

describe("MailError", () => {
	it("has correct code and statusCode", () => {
		const err = new MailError("test");
		expect(err.code).toBe("WORKKIT_MAIL_ERROR");
		expect(err.statusCode).toBe(500);
		expect(err.retryable).toBe(false);
	});
});

describe("InvalidAddressError", () => {
	it("stores the invalid address", () => {
		const err = new InvalidAddressError("bad@");
		expect(err.address).toBe("bad@");
		expect(err.code).toBe("WORKKIT_MAIL_INVALID_ADDRESS");
		expect(err.statusCode).toBe(400);
		expect(err.retryable).toBe(false);
	});

	it("includes address in message", () => {
		const err = new InvalidAddressError("not-email");
		expect(err.message).toContain("not-email");
	});

	it("serializes correctly", () => {
		const err = new InvalidAddressError("bad@");
		const json = err.toJSON();
		expect(json.code).toBe("WORKKIT_MAIL_INVALID_ADDRESS");
		expect(json.context?.address).toBe("bad@");
	});
});

describe("DeliveryError", () => {
	it("is retryable with exponential strategy", () => {
		const err = new DeliveryError("failed");
		expect(err.code).toBe("WORKKIT_MAIL_DELIVERY_FAILED");
		expect(err.statusCode).toBe(502);
		expect(err.retryable).toBe(true);
		expect(err.retryStrategy.kind).toBe("exponential");
	});

	it("preserves cause", () => {
		const cause = new Error("network");
		const err = new DeliveryError("failed", { cause });
		expect(err.cause).toBe(cause);
	});
});
