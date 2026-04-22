import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribe } from "../src/client";

interface StreamHandle {
	response: Response;
	push: (chunk: string) => void;
	close: () => void;
	error: () => void;
}

function makeStreamResponse(status = 200): StreamHandle {
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	const stream = new ReadableStream<Uint8Array>({
		start(c) {
			controller = c;
		},
	});
	const response = new Response(stream, {
		status,
		headers: { "content-type": "text/event-stream" },
	});
	const encoder = new TextEncoder();
	return {
		response,
		push: (chunk) => controller.enqueue(encoder.encode(chunk)),
		close: () => controller.close(),
		error: () => controller.error(new Error("stream error")),
	};
}

// Yield to the event loop so fetch / reader microtasks can flush.
const flush = async () => {
	for (let i = 0; i < 5; i++) await Promise.resolve();
	await new Promise((r) => setTimeout(r, 0));
};

describe("subscribe", () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("fetches the subscribe URL with lastEventId=0 on first connect", async () => {
		const stream = makeStreamResponse();
		fetchMock.mockResolvedValue(stream.response);

		const sub = subscribe("/sse/test", { onEvent: () => {} });
		await flush();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const call = fetchMock.mock.calls[0];
		expect(call[0]).toBe("/sse/test?lastEventId=0");
		expect(call[1].headers.accept).toBe("text/event-stream");
		sub.unsubscribe();
		stream.close();
	});

	it("parses SSE frames and invokes onEvent with typed data", async () => {
		const stream = makeStreamResponse();
		fetchMock.mockResolvedValue(stream.response);
		const received: Array<{ event: string; data: unknown; id: number }> = [];

		const sub = subscribe("/sse/test", {
			onEvent: (event, data, id) => received.push({ event, data, id }),
		});
		await flush();

		stream.push('event: run.stage\nid: 1\ndata: {"stage":"verify"}\n\n');
		await flush();
		stream.push('event: run.stage\nid: 2\ndata: {"stage":"done"}\n\n');
		await flush();

		expect(received).toEqual([
			{ event: "run.stage", data: { stage: "verify" }, id: 1 },
			{ event: "run.stage", data: { stage: "done" }, id: 2 },
		]);
		sub.unsubscribe();
		stream.close();
	});

	it("sends Last-Event-ID header (as well as query param) once lastEventId > 0", async () => {
		const first = makeStreamResponse();
		const second = makeStreamResponse();
		fetchMock.mockResolvedValueOnce(first.response).mockResolvedValue(second.response);

		const sub = subscribe("/sse/test", {
			onEvent: () => {},
			backoff: { initialMs: 10, maxMs: 10 },
		});
		await flush();
		// First connect: no prior lastEventId → no header.
		expect(fetchMock.mock.calls[0][1].headers["Last-Event-ID"]).toBeUndefined();

		first.push("event: x\nid: 42\ndata: a\n\n");
		await flush();
		first.close();
		await new Promise((r) => setTimeout(r, 30));
		await flush();

		// Reconnect: header must carry the last seen id.
		expect(fetchMock.mock.calls[1][1].headers["Last-Event-ID"]).toBe("42");
		sub.unsubscribe();
		second.close();
	});

	it("includes updated lastEventId in URL on reconnect", async () => {
		const first = makeStreamResponse();
		const second = makeStreamResponse();
		fetchMock.mockResolvedValueOnce(first.response).mockResolvedValue(second.response);

		const sub = subscribe("/sse/test", {
			onEvent: () => {},
			backoff: { initialMs: 10, maxMs: 10 },
		});
		await flush();
		first.push("event: x\nid: 7\ndata: a\n\n");
		await flush();
		first.close();
		// Wait for reconnect backoff + scheduled retry
		await new Promise((r) => setTimeout(r, 30));
		await flush();

		expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect(fetchMock.mock.calls[1][0]).toBe("/sse/test?lastEventId=7");
		sub.unsubscribe();
		second.close();
	});

	it("invokes onReconnect with attempt count on reconnect", async () => {
		const first = makeStreamResponse();
		const second = makeStreamResponse();
		fetchMock.mockResolvedValueOnce(first.response).mockResolvedValue(second.response);
		const onReconnect = vi.fn();

		const sub = subscribe("/sse/test", {
			onEvent: () => {},
			onReconnect,
			backoff: { initialMs: 10, maxMs: 10 },
		});
		await flush();
		first.close();
		await new Promise((r) => setTimeout(r, 30));
		await flush();

		expect(onReconnect).toHaveBeenCalledWith(1);
		sub.unsubscribe();
		second.close();
	});

	it("unsubscribe() aborts the in-flight fetch", async () => {
		const stream = makeStreamResponse();
		fetchMock.mockImplementation((_url: string, init: RequestInit) => {
			return new Promise<Response>((resolve, reject) => {
				init.signal?.addEventListener("abort", () => {
					const err = new Error("aborted");
					err.name = "AbortError";
					reject(err);
				});
				resolve(stream.response);
			});
		});

		const sub = subscribe("/sse/test", { onEvent: () => {} });
		await flush();
		sub.unsubscribe();
		await flush();

		// No further fetches after unsubscribe
		const callsBefore = fetchMock.mock.calls.length;
		await new Promise((r) => setTimeout(r, 50));
		expect(fetchMock.mock.calls.length).toBe(callsBefore);
	});

	it("switches to polling URL once failure window exceeded", async () => {
		const polled = new Response(JSON.stringify([{ event: "x", id: 1, data: "p" }]));
		fetchMock
			.mockResolvedValueOnce(new Response("nope", { status: 502 }))
			.mockResolvedValueOnce(polled);

		const received: Array<{ event: string; data: unknown; id: number }> = [];
		const sub = subscribe("/sse/test", {
			onEvent: (event, data, id) => received.push({ event, data, id }),
			backoff: { initialMs: 5, maxMs: 5 },
			fallbackPollingUrl: "/poll/test",
			pollingAfterMs: 0,
		});

		await new Promise((r) => setTimeout(r, 30));
		await flush();

		const pollCall = fetchMock.mock.calls.find((c) => c[0].startsWith("/poll/test"));
		expect(pollCall).toBeDefined();
		expect(received[0]).toEqual({ event: "x", data: "p", id: 1 });
		sub.unsubscribe();
	});

	it("honors opts.signal by calling unsubscribe on abort", async () => {
		const stream = makeStreamResponse();
		fetchMock.mockResolvedValue(stream.response);
		const controller = new AbortController();

		const sub = subscribe("/sse/test", { onEvent: () => {}, signal: controller.signal });
		await flush();
		controller.abort();
		await flush();

		const callsAfterAbort = fetchMock.mock.calls.length;
		await new Promise((r) => setTimeout(r, 20));
		expect(fetchMock.mock.calls.length).toBe(callsAfterAbort);
		sub.unsubscribe();
		stream.close();
	});
});
