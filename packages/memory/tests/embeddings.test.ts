import { describe, it, expect, vi } from "vitest";
import { createEmbeddingPipeline } from "../src/embeddings";

function createMockAi(returnData?: number[][]) {
  return {
    run: vi.fn(async (_model: string, _input: any) => ({
      data: returnData ?? [[0.1, 0.2, 0.3]],
    })),
  } as any;
}

function createMockD1(queryResults: any[] = []) {
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    run: vi.fn(async () => ({ success: true })),
    all: vi.fn(async () => ({ results: queryResults, success: true })),
    first: vi.fn(async () => null),
  };
  return { prepare: vi.fn(() => stmt), _stmt: stmt } as any;
}

describe("createEmbeddingPipeline", () => {
  describe("enabled property", () => {
    it("is false when no ai binding", () => {
      const pipeline = createEmbeddingPipeline();
      expect(pipeline.enabled).toBe(false);
    });

    it("is true when ai binding provided", () => {
      const ai = createMockAi();
      const pipeline = createEmbeddingPipeline({ ai });
      expect(pipeline.enabled).toBe(true);
    });
  });

  describe("dimensions property", () => {
    it("defaults to 768", () => {
      const pipeline = createEmbeddingPipeline();
      expect(pipeline.dimensions).toBe(768);
    });

    it("uses provided dimensions", () => {
      const pipeline = createEmbeddingPipeline({ dimensions: 1536 });
      expect(pipeline.dimensions).toBe(1536);
    });
  });

  describe("embed", () => {
    it("returns null when no ai binding", async () => {
      const pipeline = createEmbeddingPipeline();
      const result = await pipeline.embed("hello world");
      expect(result).toBeNull();
    });

    it("returns embedding vector from ai", async () => {
      const ai = createMockAi([[0.1, 0.2, 0.3]]);
      const pipeline = createEmbeddingPipeline({ ai });
      const result = await pipeline.embed("hello world");
      expect(result).toEqual([0.1, 0.2, 0.3]);
    });

    it("truncates text to 512*4 chars", async () => {
      const ai = createMockAi();
      const pipeline = createEmbeddingPipeline({ ai });
      const longText = "a".repeat(10000);
      await pipeline.embed(longText);

      const callArgs = ai.run.mock.calls[0];
      expect(callArgs[1].text[0].length).toBe(512 * 4);
    });

    it("uses the configured model", async () => {
      const ai = createMockAi();
      const pipeline = createEmbeddingPipeline({ ai, model: "@cf/custom/model" });
      await pipeline.embed("test");
      expect(ai.run).toHaveBeenCalledWith("@cf/custom/model", expect.anything());
    });

    it("returns null on ai error", async () => {
      const ai = { run: vi.fn(async () => { throw new Error("AI error"); }) } as any;
      const pipeline = createEmbeddingPipeline({ ai });
      const result = await pipeline.embed("test");
      expect(result).toBeNull();
    });
  });

  describe("embedBatch", () => {
    it("returns array of nulls when no ai binding", async () => {
      const pipeline = createEmbeddingPipeline();
      const result = await pipeline.embedBatch(["a", "b", "c"]);
      expect(result).toEqual([null, null, null]);
    });

    it("returns batch embeddings from ai", async () => {
      const vectors = [[0.1, 0.2], [0.3, 0.4]];
      const ai = createMockAi(vectors);
      const pipeline = createEmbeddingPipeline({ ai });
      const result = await pipeline.embedBatch(["text1", "text2"]);
      expect(result).toEqual(vectors);
    });

    it("returns nulls on ai error", async () => {
      const ai = { run: vi.fn(async () => { throw new Error("fail"); }) } as any;
      const pipeline = createEmbeddingPipeline({ ai });
      const result = await pipeline.embedBatch(["a", "b"]);
      expect(result).toEqual([null, null]);
    });
  });

  describe("storeEmbedding", () => {
    it("inserts embedding with correct binding", async () => {
      const db = createMockD1();
      const pipeline = createEmbeddingPipeline();
      const vector = [0.1, 0.2, 0.3];

      await pipeline.storeEmbedding("fact_abc", vector, db);

      expect(db.prepare).toHaveBeenCalledWith(
        expect.stringContaining("INSERT OR REPLACE INTO fact_embeddings")
      );
      expect(db._stmt.bind).toHaveBeenCalledWith("fact_abc", JSON.stringify(vector), 3);
      expect(db._stmt.run).toHaveBeenCalled();
    });
  });

  describe("loadEmbeddings", () => {
    it("returns empty map for empty factIds", async () => {
      const db = createMockD1();
      const pipeline = createEmbeddingPipeline();
      const result = await pipeline.loadEmbeddings([], db);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
      expect(db.prepare).not.toHaveBeenCalled();
    });

    it("returns map of factId -> vector", async () => {
      const rows = [
        { fact_id: "fact_1", vector: "[0.1,0.2]" },
        { fact_id: "fact_2", vector: "[0.3,0.4]" },
      ];
      const db = createMockD1(rows);
      const pipeline = createEmbeddingPipeline();
      const result = await pipeline.loadEmbeddings(["fact_1", "fact_2"], db);

      expect(result.size).toBe(2);
      expect(result.get("fact_1")).toEqual([0.1, 0.2]);
      expect(result.get("fact_2")).toEqual([0.3, 0.4]);
    });

    it("builds correct IN clause for multiple ids", async () => {
      const db = createMockD1([]);
      const pipeline = createEmbeddingPipeline();
      await pipeline.loadEmbeddings(["id_1", "id_2", "id_3"], db);

      const sql = db.prepare.mock.calls[0][0] as string;
      expect(sql).toContain("IN (?,?,?)");
    });
  });

  describe("retryPending", () => {
    it("returns 0 when no ai binding", async () => {
      const db = createMockD1();
      const pipeline = createEmbeddingPipeline();
      const count = await pipeline.retryPending(db);
      expect(count).toBe(0);
    });

    it("returns 0 when no pending facts", async () => {
      const ai = createMockAi();
      const db = createMockD1([]);
      const pipeline = createEmbeddingPipeline({ ai });
      const count = await pipeline.retryPending(db);
      expect(count).toBe(0);
    });

    it("embeds pending facts and returns count", async () => {
      const ai = createMockAi([[0.1, 0.2, 0.3]]);
      const pendingRows = [
        { id: "fact_1", text: "some text" },
        { id: "fact_2", text: "other text" },
      ];

      // First call (SELECT pending) returns rows; subsequent calls (storeEmbedding + UPDATE) use different stmts
      let callCount = 0;
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        run: vi.fn(async () => ({ success: true })),
        all: vi.fn(async () => {
          callCount++;
          // Only the first 'all' call is for pending facts
          return { results: callCount === 1 ? pendingRows : [], success: true };
        }),
      };
      const db = { prepare: vi.fn(() => stmt) } as any;

      const pipeline = createEmbeddingPipeline({ ai });
      const count = await pipeline.retryPending(db, 10);

      expect(count).toBe(2);
      expect(ai.run).toHaveBeenCalledTimes(2);
    });
  });
});
