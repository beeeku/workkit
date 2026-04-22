import { describe, expect, it } from "vitest";
import { createRingBuffer } from "../src/ring-buffer";

describe("createRingBuffer", () => {
	it("starts empty with lastId 0", () => {
		const buf = createRingBuffer<string>(5);
		expect(buf.size).toBe(0);
		expect(buf.lastId).toBe(0);
		expect(buf.since(0)).toEqual([]);
	});

	it("assigns monotonic ids on push starting at 1", () => {
		const buf = createRingBuffer<string>(5);
		expect(buf.push("a")).toBe(1);
		expect(buf.push("b")).toBe(2);
		expect(buf.push("c")).toBe(3);
		expect(buf.lastId).toBe(3);
		expect(buf.size).toBe(3);
	});

	it("since(id) returns events with id strictly greater than argument", () => {
		const buf = createRingBuffer<string>(5);
		buf.push("a");
		buf.push("b");
		buf.push("c");
		expect(buf.since(0)).toEqual([
			{ id: 1, event: "a" },
			{ id: 2, event: "b" },
			{ id: 3, event: "c" },
		]);
		expect(buf.since(1)).toEqual([
			{ id: 2, event: "b" },
			{ id: 3, event: "c" },
		]);
		expect(buf.since(3)).toEqual([]);
	});

	it("trims oldest when capacity exceeded, ids keep advancing", () => {
		const buf = createRingBuffer<string>(3);
		buf.push("a"); // 1
		buf.push("b"); // 2
		buf.push("c"); // 3
		buf.push("d"); // 4, trims "a"
		buf.push("e"); // 5, trims "b"
		expect(buf.size).toBe(3);
		expect(buf.lastId).toBe(5);
		expect(buf.since(0)).toEqual([
			{ id: 3, event: "c" },
			{ id: 4, event: "d" },
			{ id: 5, event: "e" },
		]);
	});

	it("since(id) returning all kept when id predates oldest entry", () => {
		const buf = createRingBuffer<string>(2);
		buf.push("a"); // 1
		buf.push("b"); // 2
		buf.push("c"); // 3, trims "a"
		expect(buf.since(0)).toEqual([
			{ id: 2, event: "b" },
			{ id: 3, event: "c" },
		]);
	});

	it("since(id) preserves insertion order", () => {
		const buf = createRingBuffer<number>(10);
		for (let i = 0; i < 5; i++) buf.push(i);
		const out = buf.since(0);
		expect(out.map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
		expect(out.map((e) => e.event)).toEqual([0, 1, 2, 3, 4]);
	});

	it("capacity of 0 keeps nothing but still advances ids", () => {
		const buf = createRingBuffer<string>(0);
		expect(buf.push("a")).toBe(1);
		expect(buf.size).toBe(0);
		expect(buf.lastId).toBe(1);
		expect(buf.since(0)).toEqual([]);
	});
});
