import { evaluatePolicies } from "./policy";
import type { ActionDescriptor, GuardContext, GuardResult, PolicyDefinition } from "./types";

interface GuardConfig {
	policies: Map<string, PolicyDefinition>;
	dynamicPolicies?: PolicyDefinition[];
	storage: DurableObjectNamespace;
	notificationQueue: Queue;
	auditProjection?: { recordRequest: (...args: any[]) => Promise<void> };
	generateToken: (
		requestId: string,
		approverId: string,
		action: "both",
		expiresIn: number,
	) => Promise<{ token: string; tokenId: string }>;
	baseUrl?: string;
}

export function createGuard(config: GuardConfig) {
	return async function guard(
		action: ActionDescriptor,
		_context: GuardContext,
	): Promise<GuardResult> {
		// 1. Evaluate policies
		const resolved = evaluatePolicies(action, config.policies, config.dynamicPolicies ?? []);

		if (!resolved || resolved.requiredApprovals <= 0) {
			return { status: "allowed", reason: "no-policy-matched" };
		}

		// 2. Generate request ID
		const requestId = `apr_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

		// 3. Create DO instance
		const doId = config.storage.idFromName(requestId);
		const stub = config.storage.get(doId);

		await stub.fetch(
			new Request("https://internal/create", {
				method: "POST",
				body: JSON.stringify({
					id: requestId,
					action,
					policyName: resolved.name,
					status: "pending",
					approvers: resolved.approvers,
					requiredApprovals: resolved.requiredApprovals,
					segregateRequester: resolved.segregateRequester,
					timeout: resolved.timeout,
					escalation: resolved.escalation,
					escalationInterval: resolved.escalationInterval,
					onTimeout: resolved.onTimeout,
					channels: resolved.channels,
				}),
			}),
		);

		// 4. Generate tokens and enqueue notifications
		const expiresAt = Date.now() + resolved.timeout;
		const notificationFailures: Array<{ approverId: string; error: unknown }> = [];
		for (const approverId of resolved.approvers) {
			const { token } = await config.generateToken(requestId, approverId, "both", resolved.timeout);
			const baseUrl = config.baseUrl ?? "";

			try {
				await config.notificationQueue.send({
					type: "approval_requested",
					requestId,
					approverId,
					token,
					action: action.name,
					requestedBy: action.requestedBy,
					decisionUrl: `${baseUrl}/approvals/${requestId}/decide`,
					approveUrl: `${baseUrl}/approvals/${requestId}/decide?token=${token}&action=approve`,
					denyUrl: `${baseUrl}/approvals/${requestId}/decide?token=${token}&action=deny`,
				});
			} catch (err) {
				// Log partial failure but continue notifying remaining approvers
				notificationFailures.push({ approverId, error: err });
				console.error(`[approval] Failed to notify approver ${approverId} for ${requestId}:`, err);
			}
		}
		if (notificationFailures.length > 0) {
			console.warn(
				`[approval] ${notificationFailures.length}/${resolved.approvers.length} notifications failed for request ${requestId}`,
			);
		}

		// 5. Record in audit if available
		if (config.auditProjection) {
			await config.auditProjection.recordRequest({
				id: requestId,
				action: action.name,
				requestedBy: action.requestedBy,
				requestedAt: Date.now(),
				status: "pending",
				approvers: resolved.approvers,
				requiredApprovals: resolved.requiredApprovals,
				currentApprovals: 0,
				expiresAt,
				policyName: resolved.name,
				metadata: action.metadata,
			});
		}

		return {
			status: "pending",
			requestId,
			approvers: resolved.approvers,
			expiresAt,
		};
	};
}
