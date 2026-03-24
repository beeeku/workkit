import type { MaybePromise } from "@workkit/types";

// ─── Approval States ──────────────────────────────────────────
export type ApprovalState =
	| "pending"
	| "approved"
	| "denied"
	| "escalated"
	| "timed_out"
	| "cancelled";

export type ApprovalEvent =
	| { type: "approve"; approverId: string; reason?: string }
	| { type: "deny"; approverId: string; reason: string }
	| { type: "escalate"; escalatedTo: string[]; reason: string }
	| { type: "timeout" }
	| { type: "cancel"; cancelledBy: string; reason?: string };

// ─── Action Descriptor ────────────────────────────────────────
export interface ActionDescriptor {
	name: string;
	requestedBy: string;
	cost?: { amount: number; currency: string };
	risk?: "low" | "medium" | "high" | "critical";
	tags?: string[];
	metadata?: Record<string, unknown>;
}

// ─── Policy Matchers (discriminated union) ────────────────────
export interface TagMatcher {
	type: "tag";
	allOf?: string[];
	anyOf?: string[];
	noneOf?: string[];
}

export interface CostMatcher {
	type: "cost";
	greaterThanOrEqual: number;
	currency?: string;
}

export interface RiskMatcher {
	type: "risk";
	minLevel: "low" | "medium" | "high" | "critical";
}

export interface NameMatcher {
	type: "name";
	pattern: string;
}

export interface CustomMatcher {
	type: "custom";
	fn: (action: ActionDescriptor) => boolean;
}

export interface CompositeMatcher {
	type: "all" | "any";
	matchers: PolicyMatcher[];
}

export type PolicyMatcher =
	| TagMatcher
	| CostMatcher
	| RiskMatcher
	| NameMatcher
	| CustomMatcher
	| CompositeMatcher;

// ─── Approver Spec ────────────────────────────────────────────
export type ApproverResolver = (
	action: ActionDescriptor,
	context: GuardContext,
) => Promise<string[]>;

export type ApproverSpec =
	| string[]
	| { group: string }
	| { role: string }
	| { resolve: ApproverResolver };

// ─── Policy Definition ────────────────────────────────────────
export type TimeoutCallback = (requestId: string, action: ActionDescriptor) => MaybePromise<void>;

export interface PolicyDefinition {
	match: PolicyMatcher;
	approvers: ApproverSpec;
	requiredApprovals?: number;
	timeout?: string;
	onTimeout?: "deny" | "escalate" | "auto-approve" | TimeoutCallback;
	escalation?: ApproverSpec[];
	escalationInterval?: string;
	channels?: string[];
	notificationTemplate?: NotificationTemplate;
	priority?: number;
	segregateRequester?: boolean;
	validateApproval?: (
		decision: ApprovalDecision,
		request: ApprovalRequestData,
	) => { ok: true } | { ok: false; error: string };
	approvalTTL?: string;
}

export interface ResolvedPolicy {
	name: string;
	priority: number;
	requiredApprovals: number;
	timeout: number;
	approvers: string[];
	segregateRequester: boolean;
	escalation: string[][];
	escalationInterval: number;
	onTimeout: "deny" | "escalate" | "auto-approve" | TimeoutCallback;
	channels: string[];
	approvalTTL?: number;
}

// ─── Guard ────────────────────────────────────────────────────
export interface GuardContext {
	identity: string;
	approvers?: string[];
	channels?: string[];
	metadata?: Record<string, unknown>;
}

export type GuardResult =
	| { status: "allowed"; reason: "no-policy-matched" }
	| { status: "allowed"; reason: "pre-approved"; approvalId: string }
	| { status: "pending"; requestId: string; approvers: string[]; expiresAt: number }
	| { status: "denied"; reason: string; deniedBy?: string };

// ─── Decisions ────────────────────────────────────────────────
export interface ApprovalDecision {
	token: string;
	action: "approve" | "deny";
	reason?: string;
	approverId: string;
}

export interface DecisionResult {
	requestId: string;
	newStatus: ApprovalState;
	decidedBy: string;
	decidedAt: number;
	remainingApprovals?: number;
	currentApprovals?: number;
}

// ─── Token ────────────────────────────────────────────────────
export interface ApprovalTokenPayload {
	v: 1;
	tid: string;
	rid: string;
	sub: string;
	act: "approve" | "deny" | "both";
	exp: number;
	iat: number;
	nonce: string;
}

// ─── Gate Config ──────────────────────────────────────────────
export interface ApprovalGateConfig {
	storage: DurableObjectNamespace;
	audit: D1Database;
	notificationQueue: Queue;
	signingKey:
		| { privateKey: string; publicKey: string }
		| { privateKey: CryptoKey; publicKey: CryptoKey };
	channels?: ChannelAdapter[];
	defaultTimeout?: string;
	defaultEscalationInterval?: string;
	maxPendingPerRequester?: number;
	baseUrl?: string;
}

// ─── Notifications ────────────────────────────────────────────
export interface ChannelAdapter {
	name: string;
	send(
		notification: NotificationPayload,
	): Promise<{ ok: true } | { ok: false; error: ChannelErrorInfo }>;
}

export interface ChannelErrorInfo {
	channel: string;
	message: string;
	retryable: boolean;
}

export interface NotificationPayload {
	type: "approval_requested" | "approval_decided" | "approval_escalated" | "approval_timed_out";
	request: ApprovalRequestSummary;
	recipients: string[];
	decisionUrl: string;
	approveUrl: string;
	denyUrl: string;
	templateData?: Record<string, unknown>;
}

export interface NotificationTemplate {
	title?: (request: ApprovalRequestSummary) => string;
	body?: (
		request: ApprovalRequestSummary,
		urls: { approve: string; deny: string; details: string },
	) => string;
	escalationBody?: (request: ApprovalRequestSummary, escalationLevel: number) => string;
}

// ─── Query Types ──────────────────────────────────────────────
export interface ListPendingOptions {
	requestedBy?: string;
	approverId?: string;
	actionPattern?: string;
	tags?: string[];
	cursor?: string;
	limit?: number;
}

export interface ListCompletedOptions extends ListPendingOptions {
	status?: ("approved" | "denied" | "timed_out" | "cancelled")[];
	after?: Date;
	before?: Date;
}

export interface PaginatedResult<T> {
	items: T[];
	cursor?: string;
	hasMore: boolean;
	total: number;
}

export interface ApprovalRequestSummary {
	id: string;
	action: string;
	requestedBy: string;
	requestedAt: number;
	status: ApprovalState;
	approvers: string[];
	requiredApprovals: number;
	currentApprovals: number;
	expiresAt: number;
	policyName: string;
	metadata?: Record<string, unknown>;
	completedAt?: number;
}

export interface AuditEntry {
	id: number;
	requestId: string;
	eventType: string;
	actor?: string;
	details: Record<string, unknown>;
	timestamp: number;
}

// ─── DO Internal Types ────────────────────────────────────────
export interface ApprovalRequestData {
	id: string;
	action: ActionDescriptor;
	policyName: string;
	status: ApprovalState;
	approvers: string[];
	requiredApprovals: number;
	segregateRequester: boolean;
	timeout: number;
	escalation: string[][];
	escalationInterval: number;
	onTimeout: "deny" | "escalate" | "auto-approve";
	channels: string[];
	decisions: Array<{ by: string; action: "approve" | "deny"; reason?: string; at: number }>;
	currentEscalationLevel: number;
	createdAt: number;
	completedAt?: number;
	consumedTokens: string[];
}

export interface ApprovalAuditState {
	status: ApprovalState;
	requestedBy: string;
	requestedAt: number;
	decisions: Array<{ by: string; action: "approve" | "deny"; reason?: string; at: number }>;
	escalations: Array<{ to: string[]; reason: string; at: number }>;
}

// ─── Middleware Types ─────────────────────────────────────────
export interface RequireMiddlewareOptions {
	extractAction?: (c: any) => ActionDescriptor;
	wait?: boolean;
	waitTimeout?: string;
}
