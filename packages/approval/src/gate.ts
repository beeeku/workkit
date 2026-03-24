import { Hono } from "hono";
import { createAuditProjection } from "./audit";
import { createGuard } from "./guard";
import { generateApprovalToken, verifyApprovalToken } from "./token";
import type {
	ActionDescriptor,
	ApprovalDecision,
	ApprovalGateConfig,
	ApprovalRequestSummary,
	ChannelAdapter,
	DecisionResult,
	GuardContext,
	GuardResult,
	ListCompletedOptions,
	ListPendingOptions,
	PaginatedResult,
	PolicyDefinition,
	RequireMiddlewareOptions,
} from "./types";

export function createApprovalGate(config: ApprovalGateConfig) {
	const policies = new Map<string, PolicyDefinition>();
	const channels: ChannelAdapter[] = config.channels ?? [];
	const audit = createAuditProjection(config.audit);

	// Create internal guard with token generation
	let guardFn: ReturnType<typeof createGuard> | null = null;

	function getGuard() {
		if (!guardFn) {
			guardFn = createGuard({
				policies,
				storage: config.storage,
				notificationQueue: config.notificationQueue,
				auditProjection: audit,
				generateToken: async (requestId, approverId, action, expiresIn) => {
					const key = config.signingKey;
					if (key.privateKey instanceof CryptoKey) {
						return generateApprovalToken(requestId, approverId, action, expiresIn, key.privateKey);
					}
					throw new Error(
						"Approval gate requires CryptoKey signing keys. Import string keys with @workkit/crypto importSigningKey() before creating the gate.",
					);
				},
				baseUrl: config.baseUrl,
			});
		}
		return guardFn;
	}

	return {
		policy(name: string, definition: PolicyDefinition): void {
			policies.set(name, definition);
			guardFn = null; // Reset guard to pick up new policy
		},

		channel(adapter: ChannelAdapter): void {
			channels.push(adapter);
		},

		async guard(action: ActionDescriptor, context: GuardContext): Promise<GuardResult> {
			return getGuard()(action, context);
		},

		async decide(
			requestId: string,
			decision: Pick<ApprovalDecision, "token" | "action" | "reason">,
		): Promise<DecisionResult> {
			// 1. Fetch the request from the DO to know the expected approvers
			const doId = config.storage.idFromName(requestId);
			const stub = config.storage.get(doId);
			const statusResponse = await stub.fetch(new Request("https://internal/status"));
			if (!statusResponse.ok) {
				throw new Error("Request not found");
			}
			const request = (await statusResponse.json()) as any;

			// 2. Get the public key for verification
			const publicKey = config.signingKey.publicKey;
			if (!(publicKey instanceof CryptoKey)) {
				throw new Error(
					"Approval gate requires CryptoKey signing keys. Import string keys with @workkit/crypto importSigningKey() before creating the gate.",
				);
			}

			// 3. Verify the token (skip approver check — we extract approverId from the payload)
			const consumedTokens = new Set<string>(request.consumedTokens ?? []);
			const verification = await verifyApprovalToken(
				decision.token,
				requestId,
				undefined,
				publicKey,
				consumedTokens,
				decision.action,
			);

			if (!verification.ok) {
				throw new Error(`Token verification failed: ${verification.error.message}`);
			}
			const payload = verification.value;

			// 4. Verify the approver from the token is in the request's approver list
			if (!request.approvers?.includes(payload.sub)) {
				throw new Error(`Approver '${payload.sub}' is not authorized for this request`);
			}

			// 6. Forward to the DO with verified identity
			const response = await stub.fetch(
				new Request("https://internal/decide", {
					method: "POST",
					body: JSON.stringify({
						approverId: payload.sub,
						action: decision.action,
						reason: decision.reason,
						tokenId: payload.tid,
					}),
				}),
			);
			if (!response.ok) {
				const err = (await response.json()) as any;
				throw new Error(err.error ?? "Decision failed");
			}
			const result: DecisionResult = await response.json();
			// Keep audit projection in sync with the new status
			await audit.updateStatus(requestId, result.newStatus, result.decidedAt);
			await audit.recordDecision(requestId, {
				by: result.decidedBy,
				action: decision.action,
				reason: decision.reason,
				at: result.decidedAt,
			});
			// Update current_approvals count so audit reflects progress
			if (typeof result.currentApprovals === "number") {
				await audit.updateCurrentApprovals(requestId, result.currentApprovals);
			}
			return result;
		},

		async getRequest(requestId: string): Promise<any> {
			const doId = config.storage.idFromName(requestId);
			const stub = config.storage.get(doId);
			const response = await stub.fetch(new Request("https://internal/status"));
			if (!response.ok) return null;
			return response.json();
		},

		async listPending(
			options?: ListPendingOptions,
		): Promise<PaginatedResult<ApprovalRequestSummary>> {
			return audit.listPending(options);
		},

		async listCompleted(
			options?: ListCompletedOptions,
		): Promise<PaginatedResult<ApprovalRequestSummary>> {
			return audit.listCompleted(options);
		},

		createRouter(): Hono {
			const app = new Hono();

			// Static routes must come before dynamic /:requestId to avoid shadowing
			app.get("/approvals/pending", async (c) => {
				const options: ListPendingOptions = {
					limit: Number(c.req.query("limit") ?? 20),
					requestedBy: c.req.query("requestedBy") ?? undefined,
					cursor: c.req.query("cursor") ?? undefined,
					actionPattern: c.req.query("actionPattern") ?? undefined,
				};
				return c.json(await this.listPending(options));
			});

			app.get("/approvals/completed", async (c) => {
				const afterParam = c.req.query("after");
				const beforeParam = c.req.query("before");
				const statusParam = c.req.query("status");
				const options: ListCompletedOptions = {
					limit: Number(c.req.query("limit") ?? 20),
					requestedBy: c.req.query("requestedBy") ?? undefined,
					cursor: c.req.query("cursor") ?? undefined,
					actionPattern: c.req.query("actionPattern") ?? undefined,
					status: statusParam
						? (statusParam.split(",") as ListCompletedOptions["status"])
						: undefined,
					after: afterParam ? new Date(afterParam) : undefined,
					before: beforeParam ? new Date(beforeParam) : undefined,
				};
				return c.json(await this.listCompleted(options));
			});

			// GET handler for email/Telegram approval links (?token=...&action=approve|deny)
			// Routes through this.decide() which performs full token verification.
			app.get("/approvals/:requestId/decide", async (c) => {
				const requestId = c.req.param("requestId");
				const token = c.req.query("token");
				const action = c.req.query("action") as "approve" | "deny" | undefined;
				if (!token || !action) {
					return c.json({ error: "Missing token or action query parameter" }, 400);
				}
				try {
					const result = await this.decide(requestId, { token, action });
					return c.json(result);
				} catch (error: any) {
					return c.json({ error: error.message }, 400);
				}
			});

			app.post("/approvals/:requestId/decide", async (c) => {
				const requestId = c.req.param("requestId");
				const body = (await c.req.json()) as {
					token: string;
					action: "approve" | "deny";
					reason?: string;
				};
				try {
					const result = await this.decide(requestId, {
						token: body.token,
						action: body.action,
						reason: body.reason,
					});
					return c.json(result);
				} catch (error: any) {
					return c.json({ error: error.message }, 400);
				}
			});

			app.get("/approvals/:requestId", async (c) => {
				const requestId = c.req.param("requestId");
				const request = await this.getRequest(requestId);
				if (!request) return c.json({ error: "Not found" }, 404);
				return c.json(request);
			});

			app.get("/approvals/:requestId/audit", async (c) => {
				const requestId = c.req.param("requestId");
				const trail = await audit.getAuditTrail(requestId);
				return c.json({ events: trail });
			});

			app.post("/approvals/:requestId/cancel", async (c) => {
				const requestId = c.req.param("requestId");
				const body = await c.req.json();
				const doId = config.storage.idFromName(requestId);
				const stub = config.storage.get(doId);
				const response = await stub.fetch(
					new Request("https://internal/cancel", {
						method: "POST",
						body: JSON.stringify(body),
					}),
				);
				if (!response.ok) {
					const err = (await response.json()) as any;
					return c.json({ error: err.error }, 400);
				}
				// Sync audit projection to reflect cancellation
				await audit.updateStatus(requestId, "cancelled");
				return c.json({ ok: true });
			});

			return app;
		},

		require(options?: RequireMiddlewareOptions) {
			const gate = this;
			return async function approvalMiddleware(c: any, next: () => Promise<void>): Promise<any> {
				const extractAction =
					options?.extractAction ??
					((c: any) => ({
						name: `${c.req.method}:${c.req.path}`,
						requestedBy: c.req.header("X-User-Id") ?? "anonymous",
					}));

				const action = extractAction(c);
				const result = await gate.guard(action, { identity: action.requestedBy });

				if (result.status === "allowed") {
					return next();
				}

				if (result.status === "pending") {
					return c.json(
						{
							status: "pending",
							requestId: result.requestId,
							message: "Approval pending. Poll for status.",
							pollUrl: `/approvals/${result.requestId}`,
						},
						202,
					);
				}

				if (result.status === "denied") {
					return c.json(
						{
							status: "denied",
							reason: result.reason,
						},
						403,
					);
				}
			};
		},
	};
}
