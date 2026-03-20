import { describe, expect, it, vi } from "vitest";
import { createDOClient, singleton } from "../src/client";

// Mock DurableObjectNamespace, Id, and Stub
function createMockNamespace(stubHandler?: (req: Request) => Promise<Response>) {
	const defaultHandler = async (req: Request) => {
		const url = new URL(req.url);
		const method = url.pathname.slice(1); // Remove leading /
		const args = req.method === "POST" ? await req.json() : [];
		// Default: echo back method and args
		return new Response(JSON.stringify({ method, args, result: null }), {
			headers: { "Content-Type": "application/json" },
		});
	};

	const handler = stubHandler || defaultHandler;

	const stub = {
		fetch: vi.fn(handler),
	};

	const id = {
		toString: () => "mock-id-123",
	};

	const namespace = {
		idFromName: vi.fn(() => id),
		get: vi.fn(() => stub),
		newUniqueId: vi.fn(() => id),
	};

	return { namespace, stub, id };
}

describe("createDOClient", () => {
	interface CounterAPI {
		increment(amount: number): Promise<number>;
		getCount(): Promise<number>;
		reset(): Promise<void>;
	}

	it("should create a client from namespace and id", () => {
		const { namespace, id } = createMockNamespace();
		const client = createDOClient<CounterAPI>(namespace as any, id as any);
		expect(client).toBeDefined();
	});

	it("should call methods on the stub via fetch", async () => {
		const { namespace, stub, id } = createMockNamespace(async (req) => {
			const url = new URL(req.url);
			const method = url.pathname.slice(1);
			const args = (await req.json()) as number[];
			if (method === "increment") {
				return new Response(JSON.stringify(args[0] + 5));
			}
			return new Response("null");
		});

		const client = createDOClient<CounterAPI>(namespace as any, id as any);
		const result = await client.increment(5);
		expect(result).toBe(10);
		expect(stub.fetch).toHaveBeenCalledOnce();
	});

	it("should pass arguments correctly", async () => {
		let capturedArgs: unknown = null;
		const { namespace, id } = createMockNamespace(async (req) => {
			capturedArgs = await req.json();
			return new Response(JSON.stringify(capturedArgs));
		});

		const client = createDOClient<CounterAPI>(namespace as any, id as any);
		await client.increment(42);
		expect(capturedArgs).toEqual([42]);
	});

	it("should handle void return type", async () => {
		const { namespace, id } = createMockNamespace(async () => {
			return new Response("null");
		});

		const client = createDOClient<CounterAPI>(namespace as any, id as any);
		const result = await client.reset();
		expect(result).toBeNull();
	});

	it("should handle no-argument methods", async () => {
		const { namespace, stub, id } = createMockNamespace(async (req) => {
			const url = new URL(req.url);
			if (url.pathname === "/getCount") {
				return new Response("99");
			}
			return new Response("null");
		});

		const client = createDOClient<CounterAPI>(namespace as any, id as any);
		const result = await client.getCount();
		expect(result).toBe(99);
	});

	it("should propagate errors from the stub", async () => {
		const { namespace, id } = createMockNamespace(async () => {
			return new Response(JSON.stringify({ error: "Something broke" }), {
				status: 500,
			});
		});

		const client = createDOClient<CounterAPI>(namespace as any, id as any);
		await expect(client.increment(1)).rejects.toThrow();
	});

	it("should use POST method for RPC calls", async () => {
		const { namespace, stub, id } = createMockNamespace(async () => {
			return new Response("42");
		});

		const client = createDOClient<CounterAPI>(namespace as any, id as any);
		await client.getCount();
		const call = stub.fetch.mock.calls[0];
		const req = call[0] as Request;
		expect(req.method).toBe("POST");
	});

	it("should set content-type to application/json", async () => {
		const { namespace, stub, id } = createMockNamespace(async () => {
			return new Response("42");
		});

		const client = createDOClient<CounterAPI>(namespace as any, id as any);
		await client.increment(1);
		const call = stub.fetch.mock.calls[0];
		const req = call[0] as Request;
		expect(req.headers.get("Content-Type")).toBe("application/json");
	});
});

describe("singleton", () => {
	it("should create a stub using idFromName", () => {
		const { namespace } = createMockNamespace();
		const stub = singleton(namespace as any, "global");
		expect(namespace.idFromName).toHaveBeenCalledWith("global");
		expect(namespace.get).toHaveBeenCalled();
		expect(stub).toBeDefined();
	});

	it("should use the provided name", () => {
		const { namespace } = createMockNamespace();
		singleton(namespace as any, "config-main");
		expect(namespace.idFromName).toHaveBeenCalledWith("config-main");
	});

	it("should return the stub from get()", () => {
		const { namespace, stub } = createMockNamespace();
		const result = singleton(namespace as any, "test");
		expect(result).toBe(stub);
	});

	it("should produce consistent IDs for the same name", () => {
		const { namespace } = createMockNamespace();
		singleton(namespace as any, "my-singleton");
		singleton(namespace as any, "my-singleton");
		// Both calls should use the same name
		expect(namespace.idFromName).toHaveBeenCalledTimes(2);
		expect(namespace.idFromName).toHaveBeenNthCalledWith(1, "my-singleton");
		expect(namespace.idFromName).toHaveBeenNthCalledWith(2, "my-singleton");
	});
});
