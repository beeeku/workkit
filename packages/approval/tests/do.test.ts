import { beforeEach, describe, expect, it } from "vitest";
import { createApprovalRequestLogic } from "../src/do";
import type { ApprovalRequestData } from "../src/types";

// In-memory storage mock for testing
function createMockStorage() {
	const store = new Map<string, any>();
	return {
		get: async <T>(key: string): Promise<T | undefined> => store.get(key),
		put: async (key: string, value: any): Promise<void> => {
			store.set(key, value);
		},
		delete: async (key: string): Promise<boolean> => store.delete(key),
		list: async (): Promise<Map<string, any>> => new Map(store),
		_store: store,
	};
}

describe("ApprovalRequestLogic", () => {
	let storage: ReturnType<typeof createMockStorage>;
	let logic: ReturnType<typeof createApprovalRequestLogic>;

	beforeEach(() => {
		storage = createMockStorage();
		logic = createApprovalRequestLogic(storage as any);
	});

	const baseRequest: Omit<
		ApprovalRequestData,
		"decisions" | "consumedTokens" | "currentEscalationLevel" | "createdAt"
	> = {
		id: "apr_123",
		action: { name: "deploy:production", requestedBy: "alice", tags: ["production"] },
		policyName: "prod-deploy",
		status: "pending",
		approvers: ["bob", "carol"],
		requiredApprovals: 1,
		segregateRequester: true,
		timeout: 3600000,
		escalation: [],
		escalationInterval: 900000,
		onTimeout: "deny",
		channels: ["webhook"],
	};

	it("creates a request and stores it", async () => {
		await logic.create(baseRequest);
		const stored = await storage.get<ApprovalRequestData>("request");
		expect(stored).toBeDefined();
		expect(stored!.id).toBe("apr_123");
		expect(stored!.status).toBe("pending");
		expect(stored!.decisions).toEqual([]);
		expect(stored!.consumedTokens).toEqual([]);
		expect(stored!.createdAt).toBeGreaterThan(0);
	});

	it("approves when threshold met (1 approval needed)", async () => {
		await logic.create(baseRequest);
		const result = await logic.decide({
			approverId: "bob",
			action: "approve",
			tokenId: "tok_1",
		});

		expect(result.newStatus).toBe("approved");
		expect(result.remainingApprovals).toBe(0);

		const stored = await storage.get<ApprovalRequestData>("request");
		expect(stored!.status).toBe("approved");
		expect(stored!.completedAt).toBeDefined();
	});

	it("denies immediately on any deny", async () => {
		await logic.create(baseRequest);
		const result = await logic.decide({
			approverId: "bob",
			action: "deny",
			reason: "Not ready",
			tokenId: "tok_1",
		});

		expect(result.newStatus).toBe("denied");
		const stored = await storage.get<ApprovalRequestData>("request");
		expect(stored!.status).toBe("denied");
	});

	it("requires multiple approvals when requiredApprovals > 1", async () => {
		await logic.create({ ...baseRequest, requiredApprovals: 2 });

		const result1 = await logic.decide({
			approverId: "bob",
			action: "approve",
			tokenId: "tok_1",
		});
		expect(result1.newStatus).toBe("pending");
		expect(result1.remainingApprovals).toBe(1);

		const result2 = await logic.decide({
			approverId: "carol",
			action: "approve",
			tokenId: "tok_2",
		});
		expect(result2.newStatus).toBe("approved");
		expect(result2.remainingApprovals).toBe(0);
	});

	it("rejects self-approval when segregateRequester is true", async () => {
		await logic.create(baseRequest);
		await expect(
			logic.decide({
				approverId: "alice", // alice is the requester
				action: "approve",
				tokenId: "tok_1",
			}),
		).rejects.toThrow("cannot approve your own request");
	});

	it("rejects duplicate decision from same approver", async () => {
		await logic.create({ ...baseRequest, requiredApprovals: 2 });
		await logic.decide({ approverId: "bob", action: "approve", tokenId: "tok_1" });

		await expect(
			logic.decide({
				approverId: "bob",
				action: "approve",
				tokenId: "tok_2",
			}),
		).rejects.toThrow("already submitted");
	});

	it("rejects decision on non-pending request", async () => {
		await logic.create(baseRequest);
		await logic.decide({ approverId: "bob", action: "approve", tokenId: "tok_1" });
		// Now it's approved

		await expect(
			logic.decide({
				approverId: "carol",
				action: "approve",
				tokenId: "tok_2",
			}),
		).rejects.toThrow("not pending");
	});

	it("tracks consumed tokens", async () => {
		await logic.create(baseRequest);
		await logic.decide({ approverId: "bob", action: "approve", tokenId: "tok_1" });

		const stored = await storage.get<ApprovalRequestData>("request");
		expect(stored!.consumedTokens).toContain("tok_1");
	});

	it("rejects consumed token", async () => {
		await logic.create({ ...baseRequest, requiredApprovals: 2 });
		await logic.decide({ approverId: "bob", action: "approve", tokenId: "tok_1" });

		await expect(
			logic.decide({
				approverId: "carol",
				action: "approve",
				tokenId: "tok_1", // same token ID
			}),
		).rejects.toThrow("already been consumed");
	});

	it("cancels a pending request", async () => {
		await logic.create(baseRequest);
		await logic.cancel("alice", "Changed my mind");

		const stored = await storage.get<ApprovalRequestData>("request");
		expect(stored!.status).toBe("cancelled");
	});

	it("rejects cancel on non-pending request", async () => {
		await logic.create(baseRequest);
		await logic.decide({ approverId: "bob", action: "approve", tokenId: "tok_1" });

		await expect(logic.cancel("alice")).rejects.toThrow("not pending");
	});

	it("getStatus returns current state", async () => {
		await logic.create(baseRequest);
		const status = await logic.getStatus();
		expect(status).toBeDefined();
		expect(status!.status).toBe("pending");
		expect(status!.id).toBe("apr_123");
	});

	it("getStatus returns null for empty DO", async () => {
		const status = await logic.getStatus();
		expect(status).toBeNull();
	});
});
