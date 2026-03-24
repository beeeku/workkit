import { describe, expect, it, vi } from "vitest";
import { createWebhookChannel } from "../src/channels/webhook";
import { createApprovalGate } from "../src/gate";
import { generateApprovalKeys } from "../src/token";

function createMockDONamespace() {
	const stores = new Map<string, Map<string, any>>();
	return {
		idFromName: (name: string) => ({ toString: () => name, name }),
		get: (id: any) => {
			const key = id.toString();
			if (!stores.has(key)) stores.set(key, new Map());
			const store = stores.get(key)!;
			return {
				fetch: vi.fn(async (request: Request) => {
					const url = new URL(request.url);
					if (url.pathname === "/create") {
						const body = await request.json();
						store.set("request", {
							...body,
							decisions: [],
							consumedTokens: [],
							currentEscalationLevel: 0,
							createdAt: Date.now(),
						});
						return Response.json({ ok: true });
					}
					if (url.pathname === "/status") {
						const req = store.get("request");
						return req
							? Response.json(req)
							: Response.json({ error: "not found" }, { status: 404 });
					}
					if (url.pathname === "/decide") {
						const body = await request.json();
						const req = store.get("request");
						if (!req) return Response.json({ error: "not found" }, { status: 404 });
						req.decisions.push({ by: body.approverId, action: body.action, at: Date.now() });
						if (body.action === "deny") req.status = "denied";
						else if (
							req.decisions.filter((d: any) => d.action === "approve").length >=
							req.requiredApprovals
						)
							req.status = "approved";
						store.set("request", req);
						return Response.json({
							requestId: req.id,
							newStatus: req.status,
							decidedBy: body.approverId,
							decidedAt: Date.now(),
						});
					}
					if (url.pathname === "/cancel") {
						const req = store.get("request");
						if (req) {
							req.status = "cancelled";
							store.set("request", req);
						}
						return Response.json({ ok: true });
					}
					return Response.json({}, { status: 404 });
				}),
			};
		},
	} as any;
}

function createMockD1() {
	return {
		prepare: vi.fn(() => ({
			bind: vi.fn().mockReturnThis(),
			run: vi.fn(async () => ({ success: true })),
			first: vi.fn(async () => ({ count: 0 })),
			all: vi.fn(async () => ({ results: [], success: true })),
		})),
		exec: vi.fn(),
	} as any;
}

describe("Integration: Full Approval Flow", () => {
	async function createTestGate() {
		const signingKey = await generateApprovalKeys();
		const notificationQueue = { send: vi.fn() } as any;
		const gate = createApprovalGate({
			storage: createMockDONamespace(),
			audit: createMockD1(),
			notificationQueue,
			signingKey,
		});
		return { gate, notificationQueue };
	}

	it("guard → no policy → allowed", async () => {
		const { gate } = await createTestGate();
		const result = await gate.guard(
			{ name: "harmless-action", requestedBy: "alice" },
			{ identity: "alice" },
		);
		expect(result.status).toBe("allowed");
	});

	it("guard → policy match → pending → decide → approved", async () => {
		const { gate, notificationQueue } = await createTestGate();
		gate.policy("require-approval", {
			match: { type: "name", pattern: "deploy:*" },
			approvers: ["bob"],
			requiredApprovals: 1,
			timeout: "1h",
		});

		// Guard creates pending request
		const result = await gate.guard(
			{ name: "deploy:production", requestedBy: "alice", tags: ["production"] },
			{ identity: "alice" },
		);
		expect(result.status).toBe("pending");

		if (result.status === "pending") {
			// Extract the token from the notification queue
			const notification = notificationQueue.send.mock.calls[0][0];
			const token = notification.token;
			// Decide using token (approverId comes from the verified token)
			const decision = await gate.decide(result.requestId, {
				token,
				action: "approve",
			});
			expect(decision.newStatus).toBe("approved");
		}
	});

	it("guard → policy match → pending → deny → denied", async () => {
		const { gate, notificationQueue } = await createTestGate();
		gate.policy("require-approval", {
			match: { type: "name", pattern: "*" },
			approvers: ["bob"],
			timeout: "1h",
		});

		const result = await gate.guard(
			{ name: "delete:database", requestedBy: "alice" },
			{ identity: "alice" },
		);
		expect(result.status).toBe("pending");

		if (result.status === "pending") {
			const notification = notificationQueue.send.mock.calls[0][0];
			const token = notification.token;
			const decision = await gate.decide(result.requestId, {
				token,
				action: "deny",
				reason: "Too risky",
			});
			expect(decision.newStatus).toBe("denied");
		}
	});

	it("gate.getRequest returns request status", async () => {
		const { gate } = await createTestGate();
		gate.policy("all", {
			match: { type: "name", pattern: "*" },
			approvers: ["bob"],
			timeout: "1h",
		});

		const result = await gate.guard({ name: "test", requestedBy: "alice" }, { identity: "alice" });

		if (result.status === "pending") {
			const status = await gate.getRequest(result.requestId);
			expect(status).toBeDefined();
			expect(status.status).toBe("pending");
		}
	});

	it("createRouter returns functional Hono app", async () => {
		const { gate } = await createTestGate();
		gate.policy("all", {
			match: { type: "name", pattern: "*" },
			approvers: ["bob"],
			timeout: "1h",
		});

		const router = gate.createRouter();

		// Test GET /approvals/pending
		const res = await router.fetch(new Request("http://localhost/approvals/pending"));
		expect(res.status).toBe(200);
	});

	it("require() middleware returns 202 for pending", async () => {
		const { gate } = await createTestGate();
		gate.policy("all", {
			match: { type: "name", pattern: "*" },
			approvers: ["bob"],
			timeout: "1h",
		});

		const middleware = gate.require();

		// Simulate Hono context
		let nextCalled = false;
		const mockContext = {
			req: {
				method: "POST",
				path: "/admin/action",
				header: (name: string) => (name === "X-User-Id" ? "alice" : undefined),
			},
			json: (body: any, status?: number) => {
				return { body, status: status ?? 200 };
			},
		};

		const result = await middleware(mockContext as any, async () => {
			nextCalled = true;
		});
		expect(nextCalled).toBe(false);
		expect(result.status).toBe(202);
		expect(result.body.status).toBe("pending");
	});
});
