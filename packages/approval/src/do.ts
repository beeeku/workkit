import type { ApprovalRequestData, DecisionResult } from "./types";

interface DecisionInput {
	approverId: string;
	action: "approve" | "deny";
	reason?: string;
	tokenId: string;
}

interface StorageLike {
	get<T>(key: string): Promise<T | undefined>;
	put(key: string, value: any): Promise<void>;
}

export function createApprovalRequestLogic(storage: StorageLike) {
	async function getRequest(): Promise<ApprovalRequestData | null> {
		return (await storage.get<ApprovalRequestData>("request")) ?? null;
	}

	return {
		async create(
			input: Omit<
				ApprovalRequestData,
				"decisions" | "consumedTokens" | "currentEscalationLevel" | "createdAt"
			>,
		): Promise<void> {
			const request: ApprovalRequestData = {
				...input,
				decisions: [],
				consumedTokens: [],
				currentEscalationLevel: 0,
				createdAt: Date.now(),
			};
			await storage.put("request", request);
		},

		async decide(decision: DecisionInput): Promise<DecisionResult> {
			const request = await getRequest();
			if (!request) throw new Error("Request not found");

			// State check
			if (!["pending", "escalated"].includes(request.status)) {
				throw new Error(`Request is not pending (current: ${request.status})`);
			}

			// Token consumed check
			if (request.consumedTokens.includes(decision.tokenId)) {
				throw new Error("This token has already been consumed");
			}

			// Segregation check
			if (request.segregateRequester && decision.approverId === request.action.requestedBy) {
				throw new Error("You cannot approve your own request");
			}

			// Duplicate check
			if (request.decisions.some((d) => d.by === decision.approverId)) {
				throw new Error("You have already submitted a decision for this request");
			}

			// Record decision
			request.decisions.push({
				by: decision.approverId,
				action: decision.action,
				reason: decision.reason,
				at: Date.now(),
			});
			request.consumedTokens.push(decision.tokenId);

			const approvalCount = request.decisions.filter((d) => d.action === "approve").length;

			// Check thresholds
			if (decision.action === "deny") {
				request.status = "denied";
				request.completedAt = Date.now();
			} else if (approvalCount >= request.requiredApprovals) {
				request.status = "approved";
				request.completedAt = Date.now();
			}

			await storage.put("request", request);

			return {
				requestId: request.id,
				newStatus: request.status,
				decidedBy: decision.approverId,
				decidedAt: Date.now(),
				remainingApprovals: Math.max(0, request.requiredApprovals - approvalCount),
			};
		},

		async cancel(_cancelledBy: string, _reason?: string): Promise<void> {
			const request = await getRequest();
			if (!request) throw new Error("Request not found");
			if (!["pending", "escalated"].includes(request.status)) {
				throw new Error(`Request is not pending (current: ${request.status})`);
			}
			request.status = "cancelled";
			request.completedAt = Date.now();
			await storage.put("request", request);
		},

		async getStatus(): Promise<ApprovalRequestData | null> {
			return getRequest();
		},
	};
}

// The actual DO class — wraps the logic with real DO storage
export class ApprovalRequestDO implements DurableObject {
	private logic: ReturnType<typeof createApprovalRequestLogic>;

	constructor(private _state: DurableObjectState) {
		this.logic = createApprovalRequestLogic(this._state.storage);
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		try {
			if (request.method === "POST" && path === "/create") {
				const body = (await request.json()) as Omit<
					ApprovalRequestData,
					"decisions" | "consumedTokens" | "currentEscalationLevel" | "createdAt"
				>;
				await this.logic.create(body);
				return Response.json({ ok: true });
			}

			if (request.method === "POST" && path === "/decide") {
				const body = (await request.json()) as DecisionInput;
				const result = await this.logic.decide(body);
				return Response.json(result);
			}

			if (request.method === "POST" && path === "/cancel") {
				const body = (await request.json()) as { cancelledBy: string; reason?: string };
				await this.logic.cancel(body.cancelledBy, body.reason);
				return Response.json({ ok: true });
			}

			if (request.method === "GET" && path === "/status") {
				const status = await this.logic.getStatus();
				if (!status) return Response.json({ error: "Not found" }, { status: 404 });
				return Response.json(status);
			}

			return Response.json({ error: "Not found" }, { status: 404 });
		} catch (error: any) {
			return Response.json({ error: error.message }, { status: 400 });
		}
	}
}
