import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuditProjection } from "../src/audit";

// Simple D1 mock
function createMockD1() {
	const results: any[] = [];
	const calls: { sql: string; binds: any[] }[] = [];

	const mockStatement = {
		bind: vi.fn((...args: any[]) => {
			calls[calls.length - 1].binds = args;
			return mockStatement;
		}),
		run: vi.fn(async () => ({ success: true, meta: {} })),
		first: vi.fn(async () => results.shift() ?? null),
		all: vi.fn(async () => ({ results: [...results], success: true })),
	};

	const db = {
		prepare: vi.fn((sql: string) => {
			calls.push({ sql, binds: [] });
			return mockStatement;
		}),
		exec: vi.fn(async (sql: string) => ({ count: 1, duration: 0 })),
		batch: vi.fn(async (stmts: any[]) => stmts.map(() => ({ success: true }))),
		_calls: calls,
		_results: results,
		_statement: mockStatement,
	};

	return db as any;
}

describe("createAuditProjection", () => {
	it("getSchema returns SQL DDL", () => {
		const db = createMockD1();
		const audit = createAuditProjection(db);
		const schema = audit.getSchema();

		expect(schema).toContain("CREATE TABLE");
		expect(schema).toContain("approval_requests");
		expect(schema).toContain("approval_events");
	});

	it("recordRequest inserts into approval_requests", async () => {
		const db = createMockD1();
		const audit = createAuditProjection(db);

		await audit.recordRequest({
			id: "apr_123",
			action: "deploy:production",
			requestedBy: "alice",
			requestedAt: Date.now(),
			status: "pending",
			approvers: ["bob"],
			requiredApprovals: 1,
			currentApprovals: 0,
			expiresAt: Date.now() + 3600000,
			policyName: "prod-deploy",
		});

		expect(db.prepare).toHaveBeenCalled();
		const insertCall = db._calls.find((c: any) => c.sql.includes("INSERT"));
		expect(insertCall).toBeDefined();
	});

	it("recordDecision inserts into approval_events", async () => {
		const db = createMockD1();
		const audit = createAuditProjection(db);

		await audit.recordDecision("apr_123", {
			by: "bob",
			action: "approve",
			at: Date.now(),
		});

		expect(db.prepare).toHaveBeenCalled();
		const insertCall = db._calls.find((c: any) => c.sql.includes("approval_events"));
		expect(insertCall).toBeDefined();
	});

	it("recordNotification inserts notification event", async () => {
		const db = createMockD1();
		const audit = createAuditProjection(db);

		await audit.recordNotification("apr_123", "webhook", "sent");

		expect(db.prepare).toHaveBeenCalled();
	});

	it("updateStatus updates the request status", async () => {
		const db = createMockD1();
		const audit = createAuditProjection(db);

		await audit.updateStatus("apr_123", "approved");

		const updateCall = db._calls.find((c: any) => c.sql.includes("UPDATE"));
		expect(updateCall).toBeDefined();
	});

	it("listPending builds correct query", async () => {
		const db = createMockD1();
		db._statement.all.mockResolvedValueOnce({ results: [], success: true });
		db._statement.first.mockResolvedValueOnce({ count: 0 });
		const audit = createAuditProjection(db);

		await audit.listPending({ limit: 10 });
		expect(db.prepare).toHaveBeenCalled();
	});
});
