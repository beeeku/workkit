import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFactStore } from "../src/facts";

function createMockD1() {
  const calls: { sql: string; binds: any[] }[] = [];
  let nextResult: any = null;
  let nextAllResults: any[] = [];

  const stmt = {
    bind: vi.fn(function(...args: any[]) {
      calls[calls.length - 1].binds = args;
      return stmt;
    }),
    run: vi.fn(async () => ({ success: true })),
    first: vi.fn(async () => nextResult),
    all: vi.fn(async () => ({ results: nextAllResults, success: true })),
  };

  return {
    prepare: vi.fn((sql: string) => {
      calls.push({ sql, binds: [] });
      return stmt;
    }),
    _calls: calls,
    _stmt: stmt,
    _setNextResult: (r: any) => { nextResult = r; },
    _setNextAllResults: (r: any[]) => { nextAllResults = r; },
  } as any;
}

describe("createFactStore", () => {
  it("remember inserts a fact and returns it", async () => {
    const db = createMockD1();
    const store = createFactStore(db);

    const result = await store.remember("User prefers dark mode", { subject: "user", tags: ["preferences"] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toMatch(/^fact_/);
      expect(result.value.text).toBe("User prefers dark mode");
      expect(result.value.subject).toBe("user");
      expect(result.value.tags).toEqual(["preferences"]);
      expect(result.value.confidence).toBe(1.0);
      expect(result.value.embeddingStatus).toBe("pending");
    }

    const insertCall = db._calls.find((c: any) => c.sql.includes("INSERT INTO facts"));
    expect(insertCall).toBeDefined();
  });

  it("remember with defaults", async () => {
    const db = createMockD1();
    const store = createFactStore(db);

    const result = await store.remember("Simple fact");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.subject).toBeNull();
      expect(result.value.source).toBeNull();
      expect(result.value.tags).toEqual([]);
      expect(result.value.confidence).toBe(1.0);
      expect(result.value.encrypted).toBe(false);
    }
  });

  it("get retrieves a fact by ID", async () => {
    const db = createMockD1();
    db._setNextResult({
      id: "fact_test123", text: "Test fact", subject: "test", source: null,
      tags: '["tag1"]', confidence: 0.9, encrypted: 0, created_at: 1000,
      valid_from: 1000, valid_until: null, superseded_by: null,
      forgotten_at: null, forgotten_reason: null, embedding_status: "complete", ttl: null,
    });
    const store = createFactStore(db);

    const result = await store.get("fact_test123");
    expect(result.ok).toBe(true);
    if (result.ok && result.value) {
      expect(result.value.id).toBe("fact_test123");
      expect(result.value.tags).toEqual(["tag1"]);
      expect(result.value.encrypted).toBe(false);
    }
  });

  it("get returns null for missing fact", async () => {
    const db = createMockD1();
    db._setNextResult(null);
    const store = createFactStore(db);

    const result = await store.get("fact_nonexistent");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeNull();
  });

  it("forget sets forgotten_at and reason", async () => {
    const db = createMockD1();
    const store = createFactStore(db);

    const result = await store.forget("fact_123", "user requested");
    expect(result.ok).toBe(true);

    const updateCall = db._calls.find((c: any) => c.sql.includes("UPDATE") && c.sql.includes("forgotten_at"));
    expect(updateCall).toBeDefined();
  });

  it("supersede creates new fact and updates old", async () => {
    const db = createMockD1();
    // Mock the old fact lookup
    db._setNextResult({ id: "fact_old", subject: "user", tags: '["pref"]', source: null });
    const store = createFactStore(db);

    const result = await store.supersede("fact_old", "New preference", { subject: "user" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toMatch(/^fact_/);
      expect(result.value.text).toBe("New preference");
    }

    // Should have both INSERT (new fact) and UPDATE (old fact)
    const insertCall = db._calls.find((c: any) => c.sql.includes("INSERT"));
    const updateCall = db._calls.find((c: any) => c.sql.includes("UPDATE") && c.sql.includes("superseded_by"));
    expect(insertCall).toBeDefined();
    expect(updateCall).toBeDefined();
  });

  it("expire sets ttl", async () => {
    const db = createMockD1();
    const store = createFactStore(db);

    const result = await store.expire("fact_123", 3600);
    expect(result.ok).toBe(true);

    const updateCall = db._calls.find((c: any) => c.sql.includes("UPDATE") && c.sql.includes("ttl"));
    expect(updateCall).toBeDefined();
  });

  it("rememberBatch inserts multiple facts", async () => {
    const db = createMockD1();
    db.batch = vi.fn(async () => [{ success: true }, { success: true }]);
    const store = createFactStore(db);

    const result = await store.rememberBatch([
      { fact: "Fact A", metadata: { tags: ["a"] } },
      { fact: "Fact B", metadata: { tags: ["b"] } },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
    }
  });
});
