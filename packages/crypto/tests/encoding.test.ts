import { describe, expect, it } from "vitest";
import { decode, encode, fromBase64, fromHex, toBase64, toHex } from "../src/encoding";

describe("encode / decode", () => {
	it("round-trips a simple ASCII string", () => {
		const result = decode(encode("hello world"));
		expect(result).toBe("hello world");
	});

	it("round-trips an empty string", () => {
		const result = decode(encode(""));
		expect(result).toBe("");
	});

	it("round-trips unicode characters", () => {
		const input = "こんにちは 🌍 café ñ";
		const result = decode(encode(input));
		expect(result).toBe(input);
	});

	it("round-trips emoji-heavy strings", () => {
		const input = "🔐🔑🛡️💀👻";
		const result = decode(encode(input));
		expect(result).toBe(input);
	});

	it("encode returns Uint8Array", () => {
		const result = encode("test");
		expect(result).toBeInstanceOf(Uint8Array);
		expect(result.length).toBeGreaterThan(0);
	});

	it("decode accepts ArrayBuffer", () => {
		const encoded = encode("test");
		const buffer = encoded.buffer.slice(
			encoded.byteOffset,
			encoded.byteOffset + encoded.byteLength,
		);
		const result = decode(buffer);
		expect(result).toBe("test");
	});

	it("handles special characters", () => {
		const input = '<script>alert("xss")</script>\n\t\r\0';
		const result = decode(encode(input));
		expect(result).toBe(input);
	});

	it("handles long strings", () => {
		const input = "a".repeat(100_000);
		const result = decode(encode(input));
		expect(result).toBe(input);
	});
});

describe("toBase64 / fromBase64", () => {
	it("round-trips bytes", () => {
		const original = new Uint8Array([0, 1, 2, 255, 128, 64]);
		const base64 = toBase64(original);
		const decoded = fromBase64(base64);
		expect(decoded).toEqual(original);
	});

	it("produces valid base64 string", () => {
		const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
		const base64 = toBase64(bytes);
		expect(base64).toBe("SGVsbG8=");
	});

	it("decodes known base64 string", () => {
		const decoded = fromBase64("SGVsbG8=");
		expect(decoded).toEqual(new Uint8Array([72, 101, 108, 108, 111]));
	});

	it("handles empty input", () => {
		const base64 = toBase64(new Uint8Array(0));
		expect(base64).toBe("");
		const decoded = fromBase64("");
		expect(decoded).toEqual(new Uint8Array(0));
	});

	it("accepts ArrayBuffer input", () => {
		const bytes = new Uint8Array([1, 2, 3]);
		const buffer = bytes.buffer;
		const base64 = toBase64(buffer);
		const decoded = fromBase64(base64);
		expect(decoded).toEqual(bytes);
	});

	it("round-trips all byte values (0-255)", () => {
		const allBytes = new Uint8Array(256);
		for (let i = 0; i < 256; i++) allBytes[i] = i;
		const base64 = toBase64(allBytes);
		const decoded = fromBase64(base64);
		expect(decoded).toEqual(allBytes);
	});
});

describe("toHex / fromHex", () => {
	it("round-trips bytes", () => {
		const original = new Uint8Array([0, 1, 15, 16, 255]);
		const hex = toHex(original);
		const decoded = fromHex(hex);
		expect(decoded).toEqual(original);
	});

	it("produces lowercase hex", () => {
		const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
		expect(toHex(bytes)).toBe("deadbeef");
	});

	it("pads single-digit hex values with zero", () => {
		const bytes = new Uint8Array([0, 1, 2, 10]);
		expect(toHex(bytes)).toBe("0001020a");
	});

	it("decodes known hex string", () => {
		const decoded = fromHex("48656c6c6f");
		expect(decoded).toEqual(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
	});

	it("handles empty input", () => {
		expect(toHex(new Uint8Array(0))).toBe("");
		expect(fromHex("")).toEqual(new Uint8Array(0));
	});

	it("accepts ArrayBuffer input", () => {
		const bytes = new Uint8Array([0xca, 0xfe]);
		const hex = toHex(bytes.buffer);
		expect(hex).toBe("cafe");
	});

	it("round-trips all byte values (0-255)", () => {
		const allBytes = new Uint8Array(256);
		for (let i = 0; i < 256; i++) allBytes[i] = i;
		const hex = toHex(allBytes);
		const decoded = fromHex(hex);
		expect(decoded).toEqual(allBytes);
	});

	it("hex output length is always 2x byte length", () => {
		for (const len of [0, 1, 16, 32, 64]) {
			const bytes = new Uint8Array(len);
			expect(toHex(bytes).length).toBe(len * 2);
		}
	});
});
