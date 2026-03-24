import { Hono } from "hono";
import { createGuard } from "./guard";
import { createAuditProjection } from "./audit";
import { generateApprovalToken } from "./token";
import type {
  ApprovalGateConfig,
  PolicyDefinition,
  ActionDescriptor,
  GuardContext,
  GuardResult,
  ChannelAdapter,
  ApprovalDecision,
  DecisionResult,
  ListPendingOptions,
  ListCompletedOptions,
  PaginatedResult,
  ApprovalRequestSummary,
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
          // TODO: Import string keys to CryptoKey. For now, fall back to simple token format.
          console.warn("Approval gate: string signing keys not yet supported, using simple token format");
          const tokenId = crypto.randomUUID();
          return { token: `${requestId}:${approverId}:${tokenId}`, tokenId };
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

    async decide(requestId: string, decision: Omit<ApprovalDecision, "token">): Promise<DecisionResult> {
      const doId = config.storage.idFromName(requestId);
      const stub = config.storage.get(doId);
      const response = await stub.fetch(new Request("https://internal/decide", {
        method: "POST",
        body: JSON.stringify(decision),
      }));
      if (!response.ok) {
        const err = await response.json() as any;
        throw new Error(err.error ?? "Decision failed");
      }
      return response.json();
    },

    async getRequest(requestId: string): Promise<any> {
      const doId = config.storage.idFromName(requestId);
      const stub = config.storage.get(doId);
      const response = await stub.fetch(new Request("https://internal/status"));
      if (!response.ok) return null;
      return response.json();
    },

    async listPending(options?: ListPendingOptions): Promise<PaginatedResult<ApprovalRequestSummary>> {
      return audit.listPending(options);
    },

    async listCompleted(options?: ListCompletedOptions): Promise<PaginatedResult<ApprovalRequestSummary>> {
      return audit.listCompleted(options);
    },

    createRouter(): Hono {
      const app = new Hono();

      // Static routes must come before dynamic /:requestId to avoid shadowing
      app.get("/approvals/pending", async (c) => {
        const options: ListPendingOptions = {
          limit: Number(c.req.query("limit") ?? 20),
          requestedBy: c.req.query("requestedBy") ?? undefined,
        };
        return c.json(await this.listPending(options));
      });

      app.get("/approvals/completed", async (c) => {
        const options: ListCompletedOptions = {
          limit: Number(c.req.query("limit") ?? 20),
        };
        return c.json(await this.listCompleted(options));
      });

      app.post("/approvals/:requestId/decide", async (c) => {
        const requestId = c.req.param("requestId");
        const body = await c.req.json();
        try {
          const result = await this.decide(requestId, body);
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
        const response = await stub.fetch(new Request("https://internal/cancel", {
          method: "POST",
          body: JSON.stringify(body),
        }));
        if (!response.ok) {
          const err = await response.json() as any;
          return c.json({ error: err.error }, 400);
        }
        return c.json({ ok: true });
      });

      return app;
    },

    require(options?: RequireMiddlewareOptions) {
      const gate = this;
      return async function approvalMiddleware(c: any, next: () => Promise<void>) {
        const extractAction = options?.extractAction ?? ((c: any) => ({
          name: `${c.req.method}:${c.req.path}`,
          requestedBy: c.req.header("X-User-Id") ?? "anonymous",
        }));

        const action = extractAction(c);
        const result = await gate.guard(action, { identity: action.requestedBy });

        if (result.status === "allowed") {
          return next();
        }

        if (result.status === "pending") {
          return c.json({
            status: "pending",
            requestId: result.requestId,
            message: "Approval pending. Poll for status.",
            pollUrl: `/approvals/${result.requestId}`,
          }, 202);
        }

        if (result.status === "denied") {
          return c.json({
            status: "denied",
            reason: result.reason,
          }, 403);
        }
      };
    },
  };
}
