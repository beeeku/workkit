import { beforeEach, describe, expect, it } from "vitest";
import { createMockQueue } from "../src/queue";

describe("createMockQueue", () => {
	let queue: ReturnType<typeof createMockQueue>;

	beforeEach(() => {
		queue = createMockQueue();
	});

	it("starts with empty messages", () => {
		expect(queue._messages).toEqual([]);
	});

	describe("send", () => {
		it("sends a text message", async () => {
			await queue.send("hello");
			expect(queue._messages).toHaveLength(1);
			expect(queue._messages[0].body).toBe("hello");
		});

		it("sends a JSON message", async () => {
			await queue.send({ event: "created", id: 1 });
			expect(queue._messages[0].body).toEqual({ event: "created", id: 1 });
		});

		it("sends with content type option", async () => {
			await queue.send("data", { contentType: "text" });
			expect(queue._messages[0].contentType).toBe("text");
		});

		it("accumulates messages", async () => {
			await queue.send("a");
			await queue.send("b");
			await queue.send("c");
			expect(queue._messages).toHaveLength(3);
		});
	});

	describe("sendBatch", () => {
		it("sends multiple messages at once", async () => {
			await queue.sendBatch([{ body: "first" }, { body: "second" }, { body: { complex: true } }]);
			expect(queue._messages).toHaveLength(3);
			expect(queue._messages[0].body).toBe("first");
			expect(queue._messages[2].body).toEqual({ complex: true });
		});

		it("preserves content type from batch items", async () => {
			await queue.sendBatch([
				{ body: "text", contentType: "text" },
				{ body: { a: 1 }, contentType: "json" },
			]);
			expect(queue._messages[0].contentType).toBe("text");
			expect(queue._messages[1].contentType).toBe("json");
		});

		it("accumulates with existing messages", async () => {
			await queue.send("existing");
			await queue.sendBatch([{ body: "new1" }, { body: "new2" }]);
			expect(queue._messages).toHaveLength(3);
		});
	});
});
