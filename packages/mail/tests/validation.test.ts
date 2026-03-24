import { describe, expect, it } from "vitest";
import { InvalidAddressError } from "../src/errors";
import { isValidAddress, validateAddress } from "../src/validation";

describe("isValidAddress()", () => {
	it("returns true for a simple valid address", () => {
		expect(isValidAddress("user@example.com")).toBe(true);
	});

	it("returns true for address with dots in local part", () => {
		expect(isValidAddress("first.last@example.com")).toBe(true);
	});

	it("returns true for address with plus tag", () => {
		expect(isValidAddress("user+tag@example.com")).toBe(true);
	});

	it("returns true for address with subdomain", () => {
		expect(isValidAddress("user@mail.example.co.uk")).toBe(true);
	});

	it("returns false for empty string", () => {
		expect(isValidAddress("")).toBe(false);
	});

	it("returns false for missing @", () => {
		expect(isValidAddress("userexample.com")).toBe(false);
	});

	it("returns false for missing domain", () => {
		expect(isValidAddress("user@")).toBe(false);
	});

	it("returns false for missing local part", () => {
		expect(isValidAddress("@example.com")).toBe(false);
	});

	it("returns false for consecutive dots in local part", () => {
		expect(isValidAddress("user..name@example.com")).toBe(false);
	});

	it("returns false for leading dot in local part", () => {
		expect(isValidAddress(".user@example.com")).toBe(false);
	});

	it("returns false for single-part TLD", () => {
		expect(isValidAddress("user@localhost")).toBe(false);
	});
});

describe("validateAddress()", () => {
	it("returns the address for valid input", () => {
		expect(validateAddress("user@example.com")).toBe("user@example.com");
	});

	it("trims whitespace", () => {
		expect(validateAddress("  user@example.com  ")).toBe("user@example.com");
	});

	it("throws InvalidAddressError for invalid input", () => {
		expect(() => validateAddress("not-an-email")).toThrow(InvalidAddressError);
	});

	it("throws InvalidAddressError for empty string", () => {
		expect(() => validateAddress("")).toThrow(InvalidAddressError);
	});
});
