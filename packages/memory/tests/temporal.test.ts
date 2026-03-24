import { describe, it, expect, vi } from "vitest";
import { createScopedMemory } from "../src/temporal";
import type { TemporalDeps } from "../src/temporal";

function makeStats() {
  return {
    totalFacts: 10,
    activeFacts: 8,
    supersededFacts: 1,
    forgottenFacts: 1,
    pendingEmbeddings: 2,
    conversations: 3,
    totalMessages: 50,
    totalSummaries: 0,
    mode: "d1-only" as const,
    embeddingModel: "@cf/baai/bge-base-en-v1.5",
  };
}

function makeDeps(overrides: Partial<TemporalDeps> = {}): TemporalDeps {
  return {
    recall: vi.fn(async () => ({ ok: true as const, value: [] })),
    search: vi.fn(async () => ({ ok: true as const, value: [] })),
    get: vi.fn(async () => ({ ok: true as const, value: null })),
    stats: vi.fn(async () => ({ ok: true as const, value: makeStats() })),
    ...overrides,
  };
}

describe("createScopedMemory", () => {
  const TIMESTAMP = 1_700_000_000_000; // fixed point in time

  describe("at(timestamp) returns ScopedMemory", () => {
    it("returns an object with recall, search, get, and stats methods", () => {
      const scoped = createScopedMemory(TIMESTAMP, makeDeps());
      expect(typeof scoped.recall).toBe("function");
      expect(typeof scoped.search).toBe("function");
      expect(typeof scoped.get).toBe("function");
      expect(typeof scoped.stats).toBe("function");
    });
  });

  describe("recall", () => {
    it("delegates to deps.recall with timeRange.to set to timestamp", async () => {
      const deps = makeDeps();
      const scoped = createScopedMemory(TIMESTAMP, deps);

      await scoped.recall("user preferences");

      expect(deps.recall).toHaveBeenCalledWith("user preferences", expect.objectContaining({
        timeRange: expect.objectContaining({ to: TIMESTAMP }),
        includeSuperseded: false,
      }));
    });

    it("merges caller options while enforcing timeRange.to ceiling", async () => {
      const deps = makeDeps();
      const scoped = createScopedMemory(TIMESTAMP, deps);

      await scoped.recall("query", { subject: "user", limit: 5, timeRange: { from: 1000 } });

      expect(deps.recall).toHaveBeenCalledWith("query", expect.objectContaining({
        subject: "user",
        limit: 5,
        timeRange: { from: 1000, to: TIMESTAMP },
        includeSuperseded: false,
      }));
    });

    it("propagates error from deps.recall", async () => {
      const deps = makeDeps({
        recall: vi.fn(async () => ({ ok: false as const, error: { code: "STORAGE_ERROR" as const, message: "fail" } })),
      });
      const scoped = createScopedMemory(TIMESTAMP, deps);
      const result = await scoped.recall("test");
      expect(result.ok).toBe(false);
    });
  });

  describe("search", () => {
    it("delegates to deps.search with timeRange.to set to timestamp", async () => {
      const deps = makeDeps();
      const scoped = createScopedMemory(TIMESTAMP, deps);

      await scoped.search("keyword");

      expect(deps.search).toHaveBeenCalledWith("keyword", expect.objectContaining({
        timeRange: expect.objectContaining({ to: TIMESTAMP }),
        includeSuperseded: false,
      }));
    });

    it("merges caller options including existing timeRange.from", async () => {
      const deps = makeDeps();
      const scoped = createScopedMemory(TIMESTAMP, deps);

      await scoped.search("text", { timeRange: { from: 500 }, tags: ["important"] });

      expect(deps.search).toHaveBeenCalledWith("text", expect.objectContaining({
        timeRange: { from: 500, to: TIMESTAMP },
        tags: ["important"],
        includeSuperseded: false,
      }));
    });

    it("propagates error from deps.search", async () => {
      const deps = makeDeps({
        search: vi.fn(async () => ({ ok: false as const, error: { code: "STORAGE_ERROR" as const, message: "oops" } })),
      });
      const scoped = createScopedMemory(TIMESTAMP, deps);
      const result = await scoped.search("query");
      expect(result.ok).toBe(false);
    });
  });

  describe("get", () => {
    it("delegates to deps.get", async () => {
      const deps = makeDeps();
      const scoped = createScopedMemory(TIMESTAMP, deps);

      await scoped.get("fact_abc");

      expect(deps.get).toHaveBeenCalledWith("fact_abc");
    });

    it("returns the fact when validFrom <= timestamp", async () => {
      const fact = {
        id: "fact_1", text: "hello", subject: null, source: null, tags: [],
        confidence: 1, encrypted: false, createdAt: TIMESTAMP - 1000,
        validFrom: TIMESTAMP - 1000, validUntil: null, supersededBy: null,
        forgottenAt: null, forgottenReason: null, embeddingStatus: "complete" as const, ttl: null,
      };
      const deps = makeDeps({ get: vi.fn(async () => ({ ok: true as const, value: fact })) });
      const scoped = createScopedMemory(TIMESTAMP, deps);

      const result = await scoped.get("fact_1");

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual(fact);
    });

    it("returns null when fact validFrom > timestamp (created after scoped time)", async () => {
      const fact = {
        id: "fact_future", text: "future fact", subject: null, source: null, tags: [],
        confidence: 1, encrypted: false, createdAt: TIMESTAMP + 5000,
        validFrom: TIMESTAMP + 5000, validUntil: null, supersededBy: null,
        forgottenAt: null, forgottenReason: null, embeddingStatus: "pending" as const, ttl: null,
      };
      const deps = makeDeps({ get: vi.fn(async () => ({ ok: true as const, value: fact })) });
      const scoped = createScopedMemory(TIMESTAMP, deps);

      const result = await scoped.get("fact_future");

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBeNull();
    });

    it("returns null when deps.get returns null", async () => {
      const deps = makeDeps({ get: vi.fn(async () => ({ ok: true as const, value: null })) });
      const scoped = createScopedMemory(TIMESTAMP, deps);

      const result = await scoped.get("nonexistent");

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toBeNull();
    });

    it("propagates error from deps.get", async () => {
      const deps = makeDeps({
        get: vi.fn(async () => ({ ok: false as const, error: { code: "STORAGE_ERROR" as const, message: "db error" } })),
      });
      const scoped = createScopedMemory(TIMESTAMP, deps);
      const result = await scoped.get("fact_1");
      expect(result.ok).toBe(false);
    });
  });

  describe("stats", () => {
    it("delegates to deps.stats", async () => {
      const deps = makeDeps();
      const scoped = createScopedMemory(TIMESTAMP, deps);

      const result = await scoped.stats();

      expect(deps.stats).toHaveBeenCalled();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.totalFacts).toBe(10);
      }
    });

    it("propagates error from deps.stats", async () => {
      const deps = makeDeps({
        stats: vi.fn(async () => ({ ok: false as const, error: { code: "STORAGE_ERROR" as const, message: "stats fail" } })),
      });
      const scoped = createScopedMemory(TIMESTAMP, deps);
      const result = await scoped.stats();
      expect(result.ok).toBe(false);
    });
  });
});
