import { describe, it, expectTypeOf } from "vitest";
import type {
  Fact,
  FactMetadata,
  MemoryError,
  MemoryResult,
  RecallResult,
  Memory,
  Conversation,
  ScopedMemory,
  MemoryStats,
  StoredMessage,
  ConversationSnapshot,
} from "../src/types";

describe("memory types", () => {
  it("Fact has all required fields", () => {
    const fact: Fact = {
      id: "fact_abc123",
      text: "The sky is blue",
      subject: "sky",
      source: "observation",
      tags: ["nature"],
      confidence: 0.9,
      encrypted: false,
      createdAt: 1000000,
      validFrom: 1000000,
      validUntil: null,
      supersededBy: null,
      forgottenAt: null,
      forgottenReason: null,
      embeddingStatus: "complete",
      ttl: null,
    };
    expectTypeOf(fact.id).toEqualTypeOf<string>();
    expectTypeOf(fact.tags).toEqualTypeOf<string[]>();
    expectTypeOf(fact.embeddingStatus).toEqualTypeOf<"complete" | "pending" | "failed">();
    expectTypeOf(fact.supersededBy).toEqualTypeOf<string | null>();
  });

  it("MemoryResult is a discriminated union", () => {
    const ok: MemoryResult<string> = { ok: true, value: "hello" };
    const err: MemoryResult<string> = { ok: false, error: { code: "NOT_FOUND", message: "missing" } };

    expectTypeOf(ok).toMatchTypeOf<MemoryResult<string>>();
    expectTypeOf(err).toMatchTypeOf<MemoryResult<string>>();

    if (ok.ok) {
      expectTypeOf(ok.value).toEqualTypeOf<string>();
    } else {
      expectTypeOf(ok.error).toMatchTypeOf<MemoryError>();
    }
  });

  it("MemoryError covers all error codes", () => {
    const codes: MemoryError["code"][] = [
      "STORAGE_ERROR",
      "EMBEDDING_ERROR",
      "VECTORIZE_ERROR",
      "CACHE_ERROR",
      "ENCRYPTION_ERROR",
      "COMPACTION_ERROR",
      "NOT_FOUND",
      "IDEMPOTENCY_ERROR",
    ];
    expectTypeOf(codes[0]).toEqualTypeOf<MemoryError["code"]>();
  });

  it("RecallResult has fact and score and signals", () => {
    expectTypeOf<RecallResult>().toHaveProperty("fact");
    expectTypeOf<RecallResult>().toHaveProperty("score");
    expectTypeOf<RecallResult>().toHaveProperty("signals");
  });

  it("Memory interface has all required methods", () => {
    expectTypeOf<Memory>().toHaveProperty("remember");
    expectTypeOf<Memory>().toHaveProperty("rememberBatch");
    expectTypeOf<Memory>().toHaveProperty("recall");
    expectTypeOf<Memory>().toHaveProperty("search");
    expectTypeOf<Memory>().toHaveProperty("get");
    expectTypeOf<Memory>().toHaveProperty("forget");
    expectTypeOf<Memory>().toHaveProperty("supersede");
    expectTypeOf<Memory>().toHaveProperty("expire");
    expectTypeOf<Memory>().toHaveProperty("at");
    expectTypeOf<Memory>().toHaveProperty("conversation");
    expectTypeOf<Memory>().toHaveProperty("stats");
    expectTypeOf<Memory>().toHaveProperty("compact");
    expectTypeOf<Memory>().toHaveProperty("reembed");
  });

  it("Conversation interface has all required methods", () => {
    expectTypeOf<Conversation>().toHaveProperty("id");
    expectTypeOf<Conversation>().toHaveProperty("add");
    expectTypeOf<Conversation>().toHaveProperty("get");
    expectTypeOf<Conversation>().toHaveProperty("summarize");
    expectTypeOf<Conversation>().toHaveProperty("clear");
    expectTypeOf<Conversation>().toHaveProperty("messages");
  });

  it("ScopedMemory interface has recall, search, get, stats", () => {
    expectTypeOf<ScopedMemory>().toHaveProperty("recall");
    expectTypeOf<ScopedMemory>().toHaveProperty("search");
    expectTypeOf<ScopedMemory>().toHaveProperty("get");
    expectTypeOf<ScopedMemory>().toHaveProperty("stats");
  });

  it("MemoryStats has correct shape", () => {
    expectTypeOf<MemoryStats>().toHaveProperty("totalFacts");
    expectTypeOf<MemoryStats>().toHaveProperty("mode");

    const mode: MemoryStats["mode"] = "d1-only";
    expectTypeOf(mode).toEqualTypeOf<"d1-only" | "d1+vectorize">();
  });

  it("StoredMessage has required fields", () => {
    expectTypeOf<StoredMessage>().toHaveProperty("id");
    expectTypeOf<StoredMessage>().toHaveProperty("conversationId");
    expectTypeOf<StoredMessage>().toHaveProperty("role");
    expectTypeOf<StoredMessage>().toHaveProperty("content");
    expectTypeOf<StoredMessage>().toHaveProperty("tokenCount");
    expectTypeOf<StoredMessage>().toHaveProperty("compactedInto");
  });

  it("FactMetadata fields are all optional", () => {
    const empty: FactMetadata = {};
    const full: FactMetadata = {
      subject: "user",
      source: "api",
      tags: ["test"],
      confidence: 1.0,
      encrypted: false,
      validFrom: 0,
      supersedes: "fact_old",
      ttl: 3600,
      idempotencyKey: "key123",
    };
    expectTypeOf(empty).toMatchTypeOf<FactMetadata>();
    expectTypeOf(full).toMatchTypeOf<FactMetadata>();
  });
});
