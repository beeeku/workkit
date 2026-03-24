import { describe, it, expectTypeOf } from "vitest";
import type {
  ApprovalState,
  ApprovalEvent,
  ActionDescriptor,
  PolicyDefinition,
  PolicyMatcher,
  TagMatcher,
  CostMatcher,
  RiskMatcher,
  NameMatcher,
  CustomMatcher,
  CompositeMatcher,
  ApproverSpec,
  GuardContext,
  GuardResult,
  ApprovalDecision,
  DecisionResult,
  ApprovalTokenPayload,
  ApprovalGateConfig,
  ChannelAdapter,
  NotificationPayload,
  ApprovalRequestSummary,
  AuditEntry,
  ListPendingOptions,
  PaginatedResult,
} from "../src/types";

describe("approval types", () => {
  it("ApprovalState covers all states", () => {
    const states: ApprovalState[] = ["pending", "approved", "denied", "escalated", "timed_out", "cancelled"];
    expectTypeOf(states[0]).toEqualTypeOf<ApprovalState>();
  });

  it("PolicyMatcher is a discriminated union", () => {
    const tag: TagMatcher = { type: "tag", allOf: ["admin"] };
    const cost: CostMatcher = { type: "cost", greaterThanOrEqual: 1000 };
    const risk: RiskMatcher = { type: "risk", minLevel: "high" };
    const name: NameMatcher = { type: "name", pattern: "deploy:*" };
    const custom: CustomMatcher = { type: "custom", fn: () => true };
    const composite: CompositeMatcher = { type: "all", matchers: [tag, cost] };

    expectTypeOf(tag).toMatchTypeOf<PolicyMatcher>();
    expectTypeOf(composite).toMatchTypeOf<PolicyMatcher>();
  });

  it("GuardResult is a discriminated union", () => {
    const allowed: GuardResult = { status: "allowed", reason: "no-policy-matched" };
    const pending: GuardResult = { status: "pending", requestId: "apr_123", approvers: ["bob"], expiresAt: 0 };
    const denied: GuardResult = { status: "denied", reason: "policy denied" };
    expectTypeOf(allowed).toMatchTypeOf<GuardResult>();
  });

  it("ApprovalTokenPayload has correct fields", () => {
    const token: ApprovalTokenPayload = {
      v: 1, tid: "t1", rid: "r1", sub: "user1",
      act: "approve", exp: 0, iat: 0, nonce: "n1",
    };
    expectTypeOf(token.v).toEqualTypeOf<1>();
    expectTypeOf(token.act).toEqualTypeOf<"approve" | "deny" | "both">();
  });

  it("ChannelAdapter has name and send", () => {
    expectTypeOf<ChannelAdapter>().toHaveProperty("name");
    expectTypeOf<ChannelAdapter>().toHaveProperty("send");
  });
});
