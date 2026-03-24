import type {
	ApprovalRequestSummary,
	ApprovalState,
	AuditEntry,
	ListCompletedOptions,
	ListPendingOptions,
	PaginatedResult,
} from "./types";

export function createAuditProjection(db: D1Database) {
	return {
		getSchema(): string {
			return `
        CREATE TABLE IF NOT EXISTS approval_requests (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          requested_by TEXT NOT NULL,
          requested_at INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          approvers TEXT NOT NULL,
          required_approvals INTEGER NOT NULL DEFAULT 1,
          current_approvals INTEGER NOT NULL DEFAULT 0,
          expires_at INTEGER NOT NULL,
          policy_name TEXT NOT NULL,
          metadata TEXT,
          completed_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );

        CREATE TABLE IF NOT EXISTS approval_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          request_id TEXT NOT NULL REFERENCES approval_requests(id),
          event_type TEXT NOT NULL,
          actor TEXT,
          details TEXT,
          timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        );

        CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
        CREATE INDEX IF NOT EXISTS idx_approval_requests_requested_by ON approval_requests(requested_by);
        CREATE INDEX IF NOT EXISTS idx_approval_events_request_id ON approval_events(request_id);
      `;
		},

		async recordRequest(summary: ApprovalRequestSummary): Promise<void> {
			await db
				.prepare(
					`INSERT INTO approval_requests (id, action, requested_by, requested_at, status, approvers, required_approvals, current_approvals, expires_at, policy_name, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					summary.id,
					summary.action,
					summary.requestedBy,
					summary.requestedAt,
					summary.status,
					JSON.stringify(summary.approvers),
					summary.requiredApprovals,
					summary.currentApprovals,
					summary.expiresAt,
					summary.policyName,
					summary.metadata ? JSON.stringify(summary.metadata) : null,
				)
				.run();
		},

		async recordDecision(
			requestId: string,
			decision: { by: string; action: string; reason?: string; at: number },
		): Promise<void> {
			await db
				.prepare(
					`INSERT INTO approval_events (request_id, event_type, actor, details, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
				)
				.bind(
					requestId,
					`decision:${decision.action}`,
					decision.by,
					JSON.stringify({ action: decision.action, reason: decision.reason }),
					decision.at,
				)
				.run();
		},

		async updateCurrentApprovals(requestId: string, currentApprovals: number): Promise<void> {
			await db
				.prepare("UPDATE approval_requests SET current_approvals = ? WHERE id = ?")
				.bind(currentApprovals, requestId)
				.run();
		},

		async recordNotification(requestId: string, channel: string, status: string): Promise<void> {
			await db
				.prepare(
					`INSERT INTO approval_events (request_id, event_type, actor, details, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
				)
				.bind(requestId, "notification", channel, JSON.stringify({ status }), Date.now())
				.run();
		},

		async updateStatus(
			requestId: string,
			status: ApprovalState,
			completedAt?: number,
		): Promise<void> {
			if (completedAt) {
				await db
					.prepare("UPDATE approval_requests SET status = ?, completed_at = ? WHERE id = ?")
					.bind(status, completedAt, requestId)
					.run();
			} else {
				await db
					.prepare("UPDATE approval_requests SET status = ? WHERE id = ?")
					.bind(status, requestId)
					.run();
			}
		},

		async listPending(
			options: ListPendingOptions = {},
		): Promise<PaginatedResult<ApprovalRequestSummary>> {
			const limit = options.limit ?? 20;
			let where = "WHERE status IN ('pending', 'escalated')";
			const binds: any[] = [];

			if (options.requestedBy) {
				where += " AND requested_by = ?";
				binds.push(options.requestedBy);
			}
			if (options.actionPattern) {
				where += " AND action LIKE ?";
				binds.push(options.actionPattern.replace("*", "%"));
			}

			const countResult = await db
				.prepare(`SELECT COUNT(*) as count FROM approval_requests ${where}`)
				.bind(...binds)
				.first<{ count: number }>();
			const total = countResult?.count ?? 0;

			let query = `SELECT * FROM approval_requests ${where} ORDER BY requested_at DESC, id DESC LIMIT ?`;
			binds.push(limit + 1);

			if (options.cursor) {
				const [cursorTs, cursorId] = parseCursor(options.cursor);
				query = query.replace(
					"ORDER BY",
					"AND (requested_at < ? OR (requested_at = ? AND id < ?)) ORDER BY",
				);
				binds.splice(binds.length - 1, 0, cursorTs, cursorTs, cursorId);
			}

			const { results } = await db
				.prepare(query)
				.bind(...binds)
				.all();
			const hasMore = results.length > limit;
			const items = (hasMore ? results.slice(0, limit) : results).map(parseRequestRow);
			const lastItem = items[items.length - 1];

			return {
				items,
				cursor: hasMore && lastItem ? `${lastItem.requestedAt}:${lastItem.id}` : undefined,
				hasMore,
				total,
			};
		},

		async listCompleted(
			options: ListCompletedOptions = {},
		): Promise<PaginatedResult<ApprovalRequestSummary>> {
			const limit = options.limit ?? 20;
			const statuses = options.status ?? ["approved", "denied", "timed_out", "cancelled"];
			const placeholders = statuses.map(() => "?").join(",");
			let where = `WHERE status IN (${placeholders})`;
			const binds: any[] = [...statuses];

			if (options.requestedBy) {
				where += " AND requested_by = ?";
				binds.push(options.requestedBy);
			}
			if (options.actionPattern) {
				where += " AND action LIKE ?";
				binds.push(options.actionPattern.replace("*", "%"));
			}
			if (options.after) {
				where += " AND completed_at >= ?";
				binds.push(options.after.getTime());
			}
			if (options.before) {
				where += " AND completed_at <= ?";
				binds.push(options.before.getTime());
			}

			const countResult = await db
				.prepare(`SELECT COUNT(*) as count FROM approval_requests ${where}`)
				.bind(...binds)
				.first<{ count: number }>();
			const total = countResult?.count ?? 0;

			let query = `SELECT * FROM approval_requests ${where} ORDER BY completed_at DESC, id DESC LIMIT ?`;
			binds.push(limit + 1);

			if (options.cursor) {
				const [cursorTs, cursorId] = parseCursor(options.cursor);
				query = query.replace(
					"ORDER BY",
					"AND (completed_at < ? OR (completed_at = ? AND id < ?)) ORDER BY",
				);
				binds.splice(binds.length - 1, 0, cursorTs, cursorTs, cursorId);
			}

			const { results } = await db
				.prepare(query)
				.bind(...binds)
				.all();
			const hasMore = results.length > limit;
			const items = (hasMore ? results.slice(0, limit) : results).map(parseRequestRow);
			const lastItem = items[items.length - 1];

			return {
				items,
				cursor:
					hasMore && lastItem
						? `${lastItem.completedAt ?? lastItem.requestedAt}:${lastItem.id}`
						: undefined,
				hasMore,
				total,
			};
		},

		async getAuditTrail(requestId: string): Promise<AuditEntry[]> {
			const { results } = await db
				.prepare("SELECT * FROM approval_events WHERE request_id = ? ORDER BY timestamp ASC")
				.bind(requestId)
				.all();

			return results.map((r: any) => ({
				id: r.id,
				requestId: r.request_id,
				eventType: r.event_type,
				actor: r.actor,
				details: r.details ? JSON.parse(r.details) : {},
				timestamp: r.timestamp,
			}));
		},
	};
}

function parseCursor(cursor: string): [number, string] {
	const sep = cursor.indexOf(":");
	if (sep === -1) {
		// Backwards-compatible: treat plain number as timestamp with empty id
		return [Number(cursor), ""];
	}
	return [Number(cursor.slice(0, sep)), cursor.slice(sep + 1)];
}

function parseRequestRow(row: any): ApprovalRequestSummary {
	return {
		id: row.id,
		action: row.action,
		requestedBy: row.requested_by,
		requestedAt: row.requested_at,
		status: row.status,
		approvers: JSON.parse(row.approvers),
		requiredApprovals: row.required_approvals,
		currentApprovals: row.current_approvals,
		expiresAt: row.expires_at,
		policyName: row.policy_name,
		metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
		completedAt: row.completed_at ?? undefined,
	};
}
