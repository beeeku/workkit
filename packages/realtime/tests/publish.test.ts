import { describe, expect, it } from "vitest";
import { publish } from "../src/publish";

interface FakeStub {
	fetch: (input: Request | string, init?: RequestInit) => Promise<Response>;
}

function fakeNamespace(respond: (req: Request) => Response | Promise<Response>): {
	namespace: DurableObjectNamespace;
	captured: Request[];
	idsRequested: string[];
} {
	const captured: Request[] = [];
	const idsRequested: string[] = [];
	const namespace = {
		idFromName(name: string) {
			idsRequested.push(name);
			return { _name: name, toString: () => name };
		},
		get(_id: unknown): FakeStub {
			return {
				fetch: async (input, init) => {
					const req = typeof input === "string" ? new Request(input, init) : input;
					captured.push(req);
					return respond(req);
				},
			};
		},
	} as unknown as DurableObjectNamespace;
	return { namespace, captured, idsRequested };
}

describe("publish", () => {
	it("resolves channel name to DO stub via idFromName", async () => {
		const { namespace, idsRequested } = fakeNamespace(
			() => new Response(JSON.stringify({ delivered: 0, id: 1 })),
		);
		await publish(namespace, "team:42:runs", "run.stage", { stage: "verify" });
		expect(idsRequested).toEqual(["team:42:runs"]);
	});

	it("POSTs JSON body with event and data to /publish", async () => {
		const { namespace, captured } = fakeNamespace(
			() => new Response(JSON.stringify({ delivered: 2, id: 5 })),
		);
		await publish(namespace, "ch", "x", { k: "v" });
		expect(captured).toHaveLength(1);
		const req = captured[0];
		expect(req.method).toBe("POST");
		expect(new URL(req.url).pathname).toBe("/publish");
		expect(req.headers.get("content-type")).toBe("application/json");
		expect(await req.json()).toEqual({ event: "x", data: { k: "v" } });
	});

	it("returns the parsed PublishResult", async () => {
		const { namespace } = fakeNamespace(
			() => new Response(JSON.stringify({ delivered: 7, id: 42 })),
		);
		const result = await publish(namespace, "ch", "x", "y");
		expect(result).toEqual({ delivered: 7, id: 42 });
	});

	it("throws with status and body when DO responds non-2xx", async () => {
		const { namespace } = fakeNamespace(() => new Response("invalid event", { status: 400 }));
		await expect(publish(namespace, "ch", "", "y")).rejects.toThrow(/400/);
	});

	it("throws eagerly if data is undefined (publisher footgun)", async () => {
		const { namespace } = fakeNamespace(
			() => new Response(JSON.stringify({ delivered: 0, id: 1 })),
		);
		await expect(publish(namespace, "ch", "e", undefined)).rejects.toThrow(/undefined/);
	});

	it("passes null and primitive data without mangling", async () => {
		const { namespace, captured } = fakeNamespace(
			() => new Response(JSON.stringify({ delivered: 0, id: 1 })),
		);
		await publish(namespace, "ch", "e", null);
		await publish(namespace, "ch", "e", 42);
		await publish(namespace, "ch", "e", "str");
		expect(await captured[0].json()).toEqual({ event: "e", data: null });
		expect(await captured[1].json()).toEqual({ event: "e", data: 42 });
		expect(await captured[2].json()).toEqual({ event: "e", data: "str" });
	});
});
