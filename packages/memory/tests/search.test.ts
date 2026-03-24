import { describe, it, expect, vi } from "vitest";
import { createSearch } from "../src/search";

function createMockD1(results: any[] = []) {
  const calls: any[] = [];
  const stmt = {
    bind: vi.fn(function(...args: any[]) { calls[calls.length - 1].binds = args; return stmt; }),
    all: vi.fn(async () => ({ results, success: true })),
  };
  return {
    prepare: vi.fn((sql: string) => { calls.push({ sql, binds: [] }); return stmt; }),
    _calls: calls,
  } as any;
}

describe("createSearch", () => {
  it("builds query with default filters", async () => {
    const db = createMockD1();
    const search = createSearch(db);
    await search("test query", { limit: 5 });

    expect(db.prepare).toHaveBeenCalled();
    const sql = db._calls[0].sql;
    expect(sql).toContain("FROM facts");
    expect(sql).toContain("forgotten_at IS NULL");
    expect(sql).toContain("LIMIT");
  });

  it("adds subject filter", async () => {
    const db = createMockD1();
    const search = createSearch(db);
    await search("test", { subject: "user" });

    const sql = db._calls[0].sql;
    expect(sql).toContain("subject =");
  });

  it("adds keyword LIKE clauses", async () => {
    const db = createMockD1();
    const search = createSearch(db);
    await search("dark mode preference");

    const sql = db._calls[0].sql;
    expect(sql).toContain("LIKE");
  });

  it("includes superseded when requested", async () => {
    const db = createMockD1();
    const search = createSearch(db);
    await search("test", { includeSuperseded: true });

    const sql = db._calls[0].sql;
    expect(sql).not.toContain("superseded_by IS NULL");
  });

  it("returns parsed facts", async () => {
    const db = createMockD1([{
      id: "fact_1", text: "Test", subject: null, source: null,
      tags: '[]', confidence: 1.0, encrypted: 0, created_at: 1000,
      valid_from: 1000, valid_until: null, superseded_by: null,
      forgotten_at: null, forgotten_reason: null, embedding_status: "complete", ttl: null,
    }]);
    const search = createSearch(db);
    const result = await search("test");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].id).toBe("fact_1");
    }
  });

  it("adds tags filter using json_each", async () => {
    const db = createMockD1();
    const search = createSearch(db);
    await search("test", { tags: ["preferences", "ui"] });

    const sql = db._calls[0].sql;
    expect(sql).toContain("json_each");
  });

  it("adds time range filters", async () => {
    const db = createMockD1();
    const search = createSearch(db);
    await search("test", { timeRange: { from: 1000, to: 9000 } });

    const sql = db._calls[0].sql;
    expect(sql).toContain("valid_from >=");
    expect(sql).toContain("valid_from <=");
  });

  it("includes forgotten facts when requested", async () => {
    const db = createMockD1();
    const search = createSearch(db);
    await search("test", { includeForgotten: true });

    const sql = db._calls[0].sql;
    expect(sql).not.toContain("forgotten_at IS NULL");
  });

  it("respects custom order and orderBy", async () => {
    const db = createMockD1();
    const search = createSearch(db);
    await search("test", { orderBy: "confidence", order: "asc" });

    const sql = db._calls[0].sql;
    expect(sql).toContain("confidence ASC");
  });

  it("returns storage error on db failure", async () => {
    const stmt = {
      bind: vi.fn().mockReturnThis(),
      all: vi.fn(async () => { throw new Error("DB exploded"); }),
    };
    const db = { prepare: vi.fn(() => stmt) } as any;
    const search = createSearch(db);
    const result = await search("test");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORAGE_ERROR");
    }
  });
});
