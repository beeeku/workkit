import { describe, it, expect, vi } from "vitest";
import { createApprovalGate } from "../src/gate";
import type { PolicyDefinition, ChannelAdapter } from "../src/types";

function createMockDONamespace() {
  return {
    idFromName: (name: string) => ({ toString: () => name }),
    get: () => ({
      fetch: vi.fn(async (req: Request) => {
        const url = new URL(req.url);
        if (url.pathname === "/create") return Response.json({ ok: true });
        if (url.pathname === "/status") return Response.json({ id: "apr_test", status: "pending" });
        if (url.pathname === "/decide") return Response.json({ requestId: "apr_test", newStatus: "approved", decidedBy: "bob", decidedAt: Date.now() });
        return Response.json({}, { status: 404 });
      }),
    }),
  } as any;
}

function createMockD1() {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn().mockReturnThis(),
      run: vi.fn(async () => ({ success: true })),
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: [], success: true })),
    })),
    exec: vi.fn(),
  } as any;
}

describe("createApprovalGate", () => {
  function createTestGate() {
    return createApprovalGate({
      storage: createMockDONamespace(),
      audit: createMockD1(),
      notificationQueue: { send: vi.fn() } as any,
      signingKey: { privateKey: "test", publicKey: "test" },
    });
  }

  it("creates a gate with config", () => {
    const gate = createTestGate();
    expect(gate).toBeDefined();
    expect(gate.policy).toBeDefined();
    expect(gate.guard).toBeDefined();
    expect(gate.channel).toBeDefined();
  });

  it("registers policies", () => {
    const gate = createTestGate();
    gate.policy("test", {
      match: { type: "name", pattern: "*" },
      approvers: ["bob"],
      timeout: "1h",
    });
    // No error = success
  });

  it("registers channels", () => {
    const gate = createTestGate();
    const webhook: ChannelAdapter = {
      name: "webhook",
      send: async () => ({ ok: true as const }),
    };
    gate.channel(webhook);
  });

  it("guard returns allowed when no policies", async () => {
    const gate = createTestGate();
    const result = await gate.guard(
      { name: "test", requestedBy: "alice" },
      { identity: "alice" },
    );
    expect(result.status).toBe("allowed");
  });

  it("guard returns pending when policy matches", async () => {
    const gate = createTestGate();
    gate.policy("all", {
      match: { type: "name", pattern: "*" },
      approvers: ["bob"],
      timeout: "1h",
    });

    const result = await gate.guard(
      { name: "deploy", requestedBy: "alice" },
      { identity: "alice" },
    );
    expect(result.status).toBe("pending");
  });

  it("createRouter returns a Hono router", () => {
    const gate = createTestGate();
    const router = gate.createRouter();
    expect(router).toBeDefined();
    // Hono instance has fetch method
    expect(typeof router.fetch).toBe("function");
  });
});
