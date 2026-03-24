import { describe, expect, it, vi } from "vitest";
import { createGuard } from "../src/guard";
import type { ActionDescriptor, ApprovalGateConfig, PolicyDefinition } from "../src/types";

// Mock DO namespace
function createMockDONamespace() {
	const instances = new Map<string, any>();
	return {
		idFromName: (name: string) => ({ toString: () => name }),
		get: (id: any) => {
			const key = id.toString();
			if (!instances.has(key)) {
				instances.set(key, {
					fetch: vi.fn(async (request: Request) => {
						const url = new URL(request.url);
						if (url.pathname === "/create") return Response.json({ ok: true });
						if (url.pathname === "/status") return Response.json({ status: "pending", id: key });
						return Response.json({ error: "not found" }, { status: 404 });
					}),
				});
			}
			return instances.get(key);
		},
		_instances: instances,
	} as any;
}

function createMockQueue() {
	const messages: any[] = [];
	return {
		send: vi.fn(async (msg: any) => {
			messages.push(msg);
		}),
		_messages: messages,
	} as any;
}

describe("createGuard", () => {
	it("returns allowed when no policy matches", async () => {
		const guard = createGuard({
			policies: new Map([
				[
					"staging",
					{ match: { type: "tag", allOf: ["staging"] }, approvers: ["bob"] } as PolicyDefinition,
				],
			]),
			storage: createMockDONamespace(),
			notificationQueue: createMockQueue(),
			generateToken: vi.fn(),
		});

		const result = await guard(
			{ name: "deploy:production", requestedBy: "alice", tags: ["production"] },
			{ identity: "alice" },
		);

		expect(result.status).toBe("allowed");
		if (result.status === "allowed") expect(result.reason).toBe("no-policy-matched");
	});

	it("returns pending when policy matches", async () => {
		const guard = createGuard({
			policies: new Map([
				[
					"prod-deploy",
					{
						match: { type: "tag", allOf: ["production"] },
						approvers: ["bob", "carol"],
						requiredApprovals: 1,
						timeout: "1h",
					} as PolicyDefinition,
				],
			]),
			storage: createMockDONamespace(),
			notificationQueue: createMockQueue(),
			generateToken: vi.fn(async () => ({ token: "tok_test", tokenId: "tid_test" })),
		});

		const result = await guard(
			{ name: "deploy:production", requestedBy: "alice", tags: ["production"] },
			{ identity: "alice" },
		);

		expect(result.status).toBe("pending");
		if (result.status === "pending") {
			expect(result.requestId).toBeDefined();
			expect(result.approvers).toEqual(["bob", "carol"]);
			expect(result.expiresAt).toBeGreaterThan(Date.now());
		}
	});

	it("creates DO instance for pending request", async () => {
		const doNamespace = createMockDONamespace();
		const guard = createGuard({
			policies: new Map([
				[
					"test",
					{
						match: { type: "name", pattern: "*" },
						approvers: ["bob"],
						timeout: "1h",
					} as PolicyDefinition,
				],
			]),
			storage: doNamespace,
			notificationQueue: createMockQueue(),
			generateToken: vi.fn(async () => ({ token: "t", tokenId: "tid" })),
		});

		await guard({ name: "test", requestedBy: "alice" }, { identity: "alice" });

		// DO instance should have been created and /create called
		expect(doNamespace._instances.size).toBe(1);
	});

	it("enqueues notifications for each approver", async () => {
		const queue = createMockQueue();
		const guard = createGuard({
			policies: new Map([
				[
					"test",
					{
						match: { type: "name", pattern: "*" },
						approvers: ["bob", "carol"],
						timeout: "1h",
					} as PolicyDefinition,
				],
			]),
			storage: createMockDONamespace(),
			notificationQueue: queue,
			generateToken: vi.fn(async () => ({ token: "t", tokenId: "tid" })),
		});

		await guard({ name: "test", requestedBy: "alice" }, { identity: "alice" });

		expect(queue.send).toHaveBeenCalled();
	});
});
