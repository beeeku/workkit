import { beforeEach, describe, expect, it } from "vitest";
import { createBroker } from "../src/broker";

const mockState = {} as unknown as DurableObjectState;
const mockEnv = {};

async function readFrames(res: Response, n: number): Promise<string[]> {
	const reader = res.body?.getReader();
	if (!reader) throw new Error("no body");
	const decoder = new TextDecoder();
	let buf = "";
	const frames: string[] = [];
	while (frames.length < n) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		let idx: number;
		while ((idx = buf.indexOf("\n\n")) !== -1 && frames.length < n) {
			frames.push(buf.slice(0, idx));
			buf = buf.slice(idx + 2);
		}
	}
	await reader.cancel();
	return frames;
}

describe("createBroker — subscribe", () => {
	it("returns 400 for invalid channel names", async () => {
		const Broker = createBroker({ authorize: async () => ({}) });
		const broker = new Broker(mockState, mockEnv);
		const res = await broker.fetch(new Request("https://do/subscribe?channel=../etc/passwd"));
		expect(res.status).toBe(400);
	});

	it("returns 400 when channel param is missing", async () => {
		const Broker = createBroker({ authorize: async () => ({}) });
		const broker = new Broker(mockState, mockEnv);
		const res = await broker.fetch(new Request("https://do/subscribe"));
		expect(res.status).toBe(400);
	});

	it("returns 403 when authorize returns null", async () => {
		const Broker = createBroker({ authorize: async () => null });
		const broker = new Broker(mockState, mockEnv);
		const res = await broker.fetch(new Request("https://do/subscribe?channel=test"));
		expect(res.status).toBe(403);
	});

	it("returns 403 when authorize throws (deny, don't surface error)", async () => {
		const Broker = createBroker({
			authorize: async () => {
				throw new Error("db down");
			},
		});
		const broker = new Broker(mockState, mockEnv);
		const res = await broker.fetch(new Request("https://do/subscribe?channel=test"));
		expect(res.status).toBe(403);
	});

	it("returns 429 when subscriber cap exceeded", async () => {
		const Broker = createBroker({
			authorize: async () => ({}),
			maxSubscribersPerChannel: 2,
		});
		const broker = new Broker(mockState, mockEnv);
		const a = await broker.fetch(new Request("https://do/subscribe?channel=test"));
		const b = await broker.fetch(new Request("https://do/subscribe?channel=test"));
		expect(a.status).toBe(200);
		expect(b.status).toBe(200);
		const c = await broker.fetch(new Request("https://do/subscribe?channel=test"));
		expect(c.status).toBe(429);
		await a.body?.cancel();
		await b.body?.cancel();
	});

	it("emits `: connected` comment on subscribe", async () => {
		const Broker = createBroker({ authorize: async () => ({}) });
		const broker = new Broker(mockState, mockEnv);
		const res = await broker.fetch(new Request("https://do/subscribe?channel=test"));
		const frames = await readFrames(res, 1);
		expect(frames[0]).toBe(": connected");
	});

	it("sets SSE response headers", async () => {
		const Broker = createBroker({ authorize: async () => ({}) });
		const broker = new Broker(mockState, mockEnv);
		const res = await broker.fetch(new Request("https://do/subscribe?channel=test"));
		expect(res.headers.get("content-type")).toBe("text/event-stream");
		expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
		await res.body?.cancel();
	});

	it("replays buffered events when Last-Event-ID header is set", async () => {
		const Broker = createBroker({ authorize: async () => ({}) });
		const broker = new Broker(mockState, mockEnv);
		await broker.fetch(
			new Request("https://do/publish", {
				method: "POST",
				body: JSON.stringify({ event: "x", data: "one" }),
			}),
		);
		await broker.fetch(
			new Request("https://do/publish", {
				method: "POST",
				body: JSON.stringify({ event: "x", data: "two" }),
			}),
		);
		const res = await broker.fetch(
			new Request("https://do/subscribe?channel=test", {
				headers: { "Last-Event-ID": "0" },
			}),
		);
		const frames = await readFrames(res, 3); // connected + 2 replays
		expect(frames[0]).toBe(": connected");
		expect(frames[1]).toContain("event: x");
		expect(frames[1]).toContain("id: 1");
		expect(frames[1]).toContain('data: "one"');
		expect(frames[2]).toContain("id: 2");
		expect(frames[2]).toContain('data: "two"');
	});

	it("accepts lastEventId via query param when header is absent", async () => {
		const Broker = createBroker({ authorize: async () => ({}) });
		const broker = new Broker(mockState, mockEnv);
		await broker.fetch(
			new Request("https://do/publish", {
				method: "POST",
				body: JSON.stringify({ event: "x", data: "one" }),
			}),
		);
		const res = await broker.fetch(new Request("https://do/subscribe?channel=test&lastEventId=0"));
		const frames = await readFrames(res, 2);
		expect(frames[1]).toContain("id: 1");
		expect(frames[1]).toContain('data: "one"');
	});

	it("honors Last-Event-ID to skip already-seen events", async () => {
		const Broker = createBroker({ authorize: async () => ({}) });
		const broker = new Broker(mockState, mockEnv);
		await broker.fetch(
			new Request("https://do/publish", {
				method: "POST",
				body: JSON.stringify({ event: "x", data: "one" }),
			}),
		);
		await broker.fetch(
			new Request("https://do/publish", {
				method: "POST",
				body: JSON.stringify({ event: "x", data: "two" }),
			}),
		);
		const res = await broker.fetch(
			new Request("https://do/subscribe?channel=test", {
				headers: { "Last-Event-ID": "1" },
			}),
		);
		const frames = await readFrames(res, 2); // connected + only event 2
		expect(frames[1]).toContain("id: 2");
		expect(frames[1]).not.toContain('data: "one"');
	});
});

describe("createBroker — publish", () => {
	it("returns 400 for malformed JSON body", async () => {
		const Broker = createBroker({ authorize: async () => ({}) });
		const broker = new Broker(mockState, mockEnv);
		const res = await broker.fetch(
			new Request("https://do/publish", { method: "POST", body: "not json" }),
		);
		expect(res.status).toBe(400);
	});

	it("returns 400 when body is missing required fields", async () => {
		const Broker = createBroker({ authorize: async () => ({}) });
		const broker = new Broker(mockState, mockEnv);
		const res = await broker.fetch(
			new Request("https://do/publish", {
				method: "POST",
				body: JSON.stringify({ event: "" }),
			}),
		);
		expect(res.status).toBe(400);
	});

	it("returns delivered: 0 when no subscribers", async () => {
		const Broker = createBroker({ authorize: async () => ({}) });
		const broker = new Broker(mockState, mockEnv);
		const res = await broker.fetch(
			new Request("https://do/publish", {
				method: "POST",
				body: JSON.stringify({ event: "x", data: "y" }),
			}),
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ delivered: 0, id: 1 });
	});

	it("fans out to every active subscriber", async () => {
		const Broker = createBroker({ authorize: async () => ({}) });
		const broker = new Broker(mockState, mockEnv);
		const subA = await broker.fetch(new Request("https://do/subscribe?channel=test"));
		const subB = await broker.fetch(new Request("https://do/subscribe?channel=test"));
		const pubRes = await broker.fetch(
			new Request("https://do/publish", {
				method: "POST",
				body: JSON.stringify({ event: "run.stage", data: { stage: "verify" } }),
			}),
		);
		expect((await pubRes.json()) as { delivered: number }).toEqual({ delivered: 2, id: 1 });
		const [, fromA] = await readFrames(subA, 2);
		const [, fromB] = await readFrames(subB, 2);
		expect(fromA).toContain("event: run.stage");
		expect(fromA).toContain('data: {"stage":"verify"}');
		expect(fromB).toContain("event: run.stage");
	});
});

describe("createBroker — config validation", () => {
	it("rejects negative replayBufferSize", () => {
		expect(() =>
			createBroker({ authorize: async () => ({}), replayBufferSize: -1 }),
		).toThrow(/replayBufferSize/);
	});

	it("rejects zero maxSubscribersPerChannel", () => {
		expect(() =>
			createBroker({ authorize: async () => ({}), maxSubscribersPerChannel: 0 }),
		).toThrow(/maxSubscribersPerChannel/);
	});

	it("rejects non-positive heartbeatMs (would create a hot loop)", () => {
		expect(() => createBroker({ authorize: async () => ({}), heartbeatMs: 0 })).toThrow(
			/heartbeatMs/,
		);
		expect(() =>
			createBroker({ authorize: async () => ({}), heartbeatMs: Number.POSITIVE_INFINITY }),
		).toThrow(/heartbeatMs/);
	});

	it("rejects non-integer replayBufferSize", () => {
		expect(() =>
			createBroker({ authorize: async () => ({}), replayBufferSize: 1.5 }),
		).toThrow(/replayBufferSize/);
	});
});

describe("createBroker — eviction gap detection", () => {
	it("emits realtime.reset when Last-Event-ID exceeds buffer.lastId (post-eviction)", async () => {
		const Broker = createBroker({ authorize: async () => ({}) });
		const broker = new Broker(mockState, mockEnv);
		// Broker is fresh — buffer.lastId === 0. Client reports id=500 (stale).
		const res = await broker.fetch(
			new Request("https://do/subscribe?channel=test", {
				headers: { "Last-Event-ID": "500" },
			}),
		);
		const frames = await readFrames(res, 2);
		expect(frames[0]).toBe(": connected");
		expect(frames[1]).toContain("event: realtime.reset");
		expect(frames[1]).toContain('"reason":"buffer_gap"');
		expect(frames[1]).toContain('"lastKnownId":500');
	});

	it("does not emit reset when Last-Event-ID is within buffer range", async () => {
		const Broker = createBroker({ authorize: async () => ({}) });
		const broker = new Broker(mockState, mockEnv);
		await broker.fetch(
			new Request("https://do/publish", {
				method: "POST",
				body: JSON.stringify({ event: "x", data: "a" }),
			}),
		);
		const res = await broker.fetch(
			new Request("https://do/subscribe?channel=test", {
				headers: { "Last-Event-ID": "1" },
			}),
		);
		const frames = await readFrames(res, 1);
		expect(frames[0]).toBe(": connected");
		expect(frames.join("\n")).not.toContain("realtime.reset");
	});
});

describe("createBroker — Last-Event-ID parse hardening", () => {
	it("treats malformed Last-Event-ID as 0 (no silent truncation)", async () => {
		const Broker = createBroker({ authorize: async () => ({}) });
		const broker = new Broker(mockState, mockEnv);
		await broker.fetch(
			new Request("https://do/publish", {
				method: "POST",
				body: JSON.stringify({ event: "x", data: "a" }),
			}),
		);
		// "500abc" must NOT parse as 500; parseInt would accept it, our regex rejects.
		const res = await broker.fetch(
			new Request("https://do/subscribe?channel=test", {
				headers: { "Last-Event-ID": "500abc" },
			}),
		);
		const frames = await readFrames(res, 2);
		// With strict parse → treated as 0 → replay event 1 (not a reset).
		expect(frames[1]).toContain("id: 1");
		expect(frames[1]).toContain('data: "a"');
	});
});

describe("createBroker — routing", () => {
	it("returns 404 for unknown paths", async () => {
		const Broker = createBroker({ authorize: async () => ({}) });
		const broker = new Broker(mockState, mockEnv);
		const res = await broker.fetch(new Request("https://do/nope"));
		expect(res.status).toBe(404);
	});

	it("returns 405 for POST /subscribe or GET /publish", async () => {
		const Broker = createBroker({ authorize: async () => ({}) });
		const broker = new Broker(mockState, mockEnv);
		const a = await broker.fetch(
			new Request("https://do/subscribe?channel=test", { method: "POST" }),
		);
		const b = await broker.fetch(new Request("https://do/publish"));
		expect(a.status).toBe(405);
		expect(b.status).toBe(405);
	});
});

describe("createBroker — authorize hook contract", () => {
	it("passes the channel name to authorize", async () => {
		let seen: string | undefined;
		const Broker = createBroker({
			authorize: async (channel) => {
				seen = channel;
				return {};
			},
		});
		const broker = new Broker(mockState, mockEnv);
		const res = await broker.fetch(new Request("https://do/subscribe?channel=team:42:runs"));
		expect(seen).toBe("team:42:runs");
		await res.body?.cancel();
	});

	it("passes the request and env to authorize", async () => {
		let seenReq: Request | undefined;
		let seenEnv: unknown;
		const Broker = createBroker({
			authorize: async (_channel, request, env) => {
				seenReq = request;
				seenEnv = env;
				return {};
			},
		});
		const env = { SECRET: "x" };
		const broker = new Broker(mockState, env);
		const res = await broker.fetch(
			new Request("https://do/subscribe?channel=test", {
				headers: { cookie: "session=abc" },
			}),
		);
		expect(seenReq?.headers.get("cookie")).toBe("session=abc");
		expect(seenEnv).toBe(env);
		await res.body?.cancel();
	});
});
