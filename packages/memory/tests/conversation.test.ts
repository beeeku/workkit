import { describe, it, expect, vi } from "vitest";
import { createConversation } from "../src/conversation";

function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: "msg_abc",
    conversation_id: "conv_1",
    role: "user",
    content: "hello",
    name: null,
    metadata: "{}",
    token_count: 2,
    created_at: Date.now(),
    compacted_into: null,
    ...overrides,
  };
}

function createMockD1(allResults: any[] = [], firstResult: any = null) {
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    run: vi.fn(async () => ({ success: true })),
    all: vi.fn(async () => ({ results: allResults, success: true })),
    first: vi.fn(async () => firstResult),
  };
  return { prepare: vi.fn(() => stmt), _stmt: stmt } as any;
}

describe("createConversation", () => {
  describe("id property", () => {
    it("exposes the conversation id", () => {
      const db = createMockD1();
      const conv = createConversation("conv_xyz", db);
      expect(conv.id).toBe("conv_xyz");
    });
  });

  describe("add", () => {
    it("inserts a message and returns StoredMessage", async () => {
      const db = createMockD1();
      const conv = createConversation("conv_1", db);

      const result = await conv.add({ role: "user", content: "hello world" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toMatch(/^msg_/);
        expect(result.value.conversationId).toBe("conv_1");
        expect(result.value.role).toBe("user");
        expect(result.value.content).toBe("hello world");
        expect(result.value.name).toBeNull();
        expect(result.value.compactedInto).toBeNull();
        expect(result.value.tokenCount).toBeGreaterThan(0);
        expect(result.value.createdAt).toBeGreaterThan(0);
      }
    });

    it("stores message with name and metadata", async () => {
      const db = createMockD1();
      const conv = createConversation("conv_1", db);

      const result = await conv.add({
        role: "assistant",
        content: "response",
        name: "assistant-1",
        metadata: { model: "gpt-4" },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("assistant-1");
        expect(result.value.metadata).toEqual({ model: "gpt-4" });
      }
    });

    it("returns storage error on db failure", async () => {
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        run: vi.fn(async () => { throw new Error("DB write failed"); }),
      };
      const db = { prepare: vi.fn(() => stmt) } as any;
      const conv = createConversation("conv_1", db);

      const result = await conv.add({ role: "user", content: "test" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("STORAGE_ERROR");
        expect(result.error.message).toContain("DB write failed");
      }
    });

    it("inserts correct SQL with all bindings", async () => {
      const db = createMockD1();
      const conv = createConversation("conv_1", db);

      await conv.add({ role: "system", content: "you are helpful" });

      const sql = (db.prepare.mock.calls[0][0] as string).toLowerCase();
      expect(sql).toContain("insert into messages");
      expect(db._stmt.bind).toHaveBeenCalled();
    });
  });

  describe("get", () => {
    it("returns snapshot with messages from db", async () => {
      const now = Date.now();
      const rows = [
        makeRow({ id: "msg_1", content: "hi", token_count: 2, created_at: now - 2000 }),
        makeRow({ id: "msg_2", content: "hello", token_count: 3, created_at: now - 1000 }),
      ];
      const db = createMockD1(rows, { count: 2 });
      const conv = createConversation("conv_1", db);

      const result = await conv.get();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe("conv_1");
        expect(result.value.messages).toHaveLength(2);
        expect(result.value.summaries).toEqual([]);
        expect(result.value.totalMessages).toBe(2);
        expect(result.value.activeMessages).toBe(2);
        expect(result.value.totalTokens).toBe(5);
      }
    });

    it("trims messages to token budget", async () => {
      const now = Date.now();
      // Create 5 messages of 100 tokens each (400 chars each)
      const rows = Array.from({ length: 5 }, (_, i) => makeRow({
        id: `msg_${i}`,
        content: "x".repeat(400), // ~100 tokens
        token_count: 100,
        created_at: now - (5 - i) * 1000,
      }));
      // Return in DESC order (newest first) as the query does
      const descRows = [...rows].reverse();
      const db = createMockD1(descRows, { count: 5 });
      const conv = createConversation("conv_1", db, { tokenBudget: 250 });

      const result = await conv.get();

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Can fit at most 2 messages of 100 tokens within budget of 250
        expect(result.value.messages.length).toBeLessThanOrEqual(2);
        expect(result.value.totalTokens).toBeLessThanOrEqual(250);
      }
    });

    it("respects custom tokenBudget in options", async () => {
      const now = Date.now();
      const rows = [
        makeRow({ id: "msg_1", content: "x".repeat(400), token_count: 100, created_at: now - 2000 }),
        makeRow({ id: "msg_2", content: "x".repeat(400), token_count: 100, created_at: now - 1000 }),
      ];
      // DESC order
      const db = createMockD1([...rows].reverse(), { count: 2 });
      const conv = createConversation("conv_1", db);

      // Override budget in get()
      const result = await conv.get({ tokenBudget: 50 });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.messages).toHaveLength(0);
      }
    });

    it("returns storage error on db failure", async () => {
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn(async () => { throw new Error("read failed"); }),
      };
      const db = { prepare: vi.fn(() => stmt) } as any;
      const conv = createConversation("conv_1", db);

      const result = await conv.get();

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("STORAGE_ERROR");
    });
  });

  describe("summarize", () => {
    it("returns compaction error (not yet implemented)", async () => {
      const db = createMockD1();
      const conv = createConversation("conv_1", db);

      const result = await conv.summarize();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("COMPACTION_ERROR");
      }
    });
  });

  describe("clear", () => {
    it("deletes messages and summaries for the conversation", async () => {
      const db = createMockD1();
      const conv = createConversation("conv_1", db);

      const result = await conv.clear();

      expect(result.ok).toBe(true);
      // Should have prepared two DELETE statements
      expect(db.prepare).toHaveBeenCalledTimes(2);
      const sqls = db.prepare.mock.calls.map((c: any[]) => c[0] as string);
      expect(sqls.some((s: string) => s.includes("DELETE FROM messages"))).toBe(true);
      expect(sqls.some((s: string) => s.includes("DELETE FROM summaries"))).toBe(true);
    });

    it("returns storage error on db failure", async () => {
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        run: vi.fn(async () => { throw new Error("delete failed"); }),
      };
      const db = { prepare: vi.fn(() => stmt) } as any;
      const conv = createConversation("conv_1", db);

      const result = await conv.clear();

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("STORAGE_ERROR");
    });
  });

  describe("messages", () => {
    it("returns messages in chronological order", async () => {
      const now = Date.now();
      const rows = [
        makeRow({ id: "msg_1", created_at: now - 2000 }),
        makeRow({ id: "msg_2", created_at: now - 1000 }),
      ];
      const db = createMockD1(rows);
      const conv = createConversation("conv_1", db);

      const result = await conv.messages();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].id).toBe("msg_1");
        expect(result.value[1].id).toBe("msg_2");
      }
    });

    it("uses default limit of 50 and offset of 0", async () => {
      const db = createMockD1([]);
      const conv = createConversation("conv_1", db);

      await conv.messages();

      expect(db._stmt.bind).toHaveBeenCalledWith("conv_1", 50, 0);
    });

    it("respects custom limit and offset", async () => {
      const db = createMockD1([]);
      const conv = createConversation("conv_1", db);

      await conv.messages({ limit: 10, offset: 20 });

      expect(db._stmt.bind).toHaveBeenCalledWith("conv_1", 10, 20);
    });

    it("excludes compacted messages by default", async () => {
      const db = createMockD1([]);
      const conv = createConversation("conv_1", db);

      await conv.messages();

      const sql = db.prepare.mock.calls[0][0] as string;
      expect(sql).toContain("compacted_into IS NULL");
    });

    it("includes compacted messages when requested", async () => {
      const db = createMockD1([]);
      const conv = createConversation("conv_1", db);

      await conv.messages({ includeCompacted: true });

      const sql = db.prepare.mock.calls[0][0] as string;
      expect(sql).not.toContain("compacted_into IS NULL");
    });

    it("returns storage error on db failure", async () => {
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn(async () => { throw new Error("list failed"); }),
      };
      const db = { prepare: vi.fn(() => stmt) } as any;
      const conv = createConversation("conv_1", db);

      const result = await conv.messages();

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("STORAGE_ERROR");
    });

    it("parses metadata from JSON string", async () => {
      const rows = [makeRow({ metadata: '{"key":"value"}' })];
      const db = createMockD1(rows);
      const conv = createConversation("conv_1", db);

      const result = await conv.messages();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value[0].metadata).toEqual({ key: "value" });
      }
    });
  });
});
