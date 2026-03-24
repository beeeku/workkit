// Gate factory (main entry point)
export { createApprovalGate } from "./gate";

// Durable Object (must be re-exported by the user's worker)
export { ApprovalRequestDO } from "./do";

// Types
export type {
	// States
	ApprovalState,
	ApprovalEvent,
	// Actions
	ActionDescriptor,
	// Policy
	PolicyDefinition,
	PolicyMatcher,
	TagMatcher,
	CostMatcher,
	RiskMatcher,
	NameMatcher,
	CustomMatcher,
	CompositeMatcher,
	ApproverSpec,
	ResolvedPolicy,
	// Guard
	GuardContext,
	GuardResult,
	// Decisions
	ApprovalDecision,
	DecisionResult,
	// Token
	ApprovalTokenPayload,
	// Config
	ApprovalGateConfig,
	// Notifications
	ChannelAdapter,
	NotificationPayload,
	ChannelErrorInfo,
	NotificationTemplate,
	// Query
	ListPendingOptions,
	ListCompletedOptions,
	PaginatedResult,
	ApprovalRequestSummary,
	AuditEntry,
	// DO
	ApprovalRequestData,
	// Middleware
	RequireMiddlewareOptions,
} from "./types";

// Utilities
export { evaluatePolicies, matchesPolicy, globMatch } from "./policy";
export { generateApprovalToken, verifyApprovalToken, generateApprovalKeys } from "./token";
export { createAuditProjection } from "./audit";
