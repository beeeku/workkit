import { describe, expect, it } from "vitest";
import { getSchema } from "../src/schema";

describe("getSchema", () => {
	it("returns a string", () => {
		expect(typeof getSchema()).toBe("string");
	});

	it("contains CREATE TABLE for facts", () => {
		expect(getSchema()).toContain("CREATE TABLE IF NOT EXISTS facts");
	});

	it("contains CREATE TABLE for fact_embeddings", () => {
		expect(getSchema()).toContain("CREATE TABLE IF NOT EXISTS fact_embeddings");
	});

	it("contains CREATE TABLE for messages", () => {
		expect(getSchema()).toContain("CREATE TABLE IF NOT EXISTS messages");
	});

	it("contains CREATE TABLE for summaries", () => {
		expect(getSchema()).toContain("CREATE TABLE IF NOT EXISTS summaries");
	});

	it("facts table has correct columns", () => {
		const schema = getSchema();
		expect(schema).toContain("id TEXT PRIMARY KEY");
		expect(schema).toContain("text TEXT NOT NULL");
		expect(schema).toContain("subject TEXT");
		expect(schema).toContain("source TEXT");
		expect(schema).toContain("tags TEXT NOT NULL");
		expect(schema).toContain("confidence REAL NOT NULL");
		expect(schema).toContain("encrypted INTEGER NOT NULL");
		expect(schema).toContain("created_at INTEGER NOT NULL");
		expect(schema).toContain("valid_from INTEGER NOT NULL");
		expect(schema).toContain("valid_until INTEGER");
		expect(schema).toContain("superseded_by TEXT");
		expect(schema).toContain("forgotten_at INTEGER");
		expect(schema).toContain("forgotten_reason TEXT");
		expect(schema).toContain("embedding_status TEXT NOT NULL");
		expect(schema).toContain("ttl INTEGER");
		expect(schema).toContain("idempotency_key TEXT UNIQUE");
	});

	it("fact_embeddings table has correct columns", () => {
		const schema = getSchema();
		expect(schema).toContain("fact_id TEXT PRIMARY KEY REFERENCES facts(id)");
		expect(schema).toContain("vector TEXT NOT NULL");
		expect(schema).toContain("dimensions INTEGER NOT NULL");
	});

	it("messages table has correct columns", () => {
		const schema = getSchema();
		expect(schema).toContain("conversation_id TEXT NOT NULL");
		expect(schema).toContain("role TEXT NOT NULL");
		expect(schema).toContain("content TEXT NOT NULL");
		expect(schema).toContain("name TEXT");
		expect(schema).toContain("metadata TEXT NOT NULL");
		expect(schema).toContain("token_count INTEGER NOT NULL");
		expect(schema).toContain("compacted_into TEXT");
	});

	it("summaries table has correct columns", () => {
		const schema = getSchema();
		expect(schema).toContain("message_range_from TEXT NOT NULL");
		expect(schema).toContain("message_range_to TEXT NOT NULL");
		expect(schema).toContain("message_count INTEGER NOT NULL");
		expect(schema).toContain("original_tokens INTEGER NOT NULL");
		expect(schema).toContain("summary_tokens INTEGER NOT NULL");
	});

	it("has index on facts(subject)", () => {
		expect(getSchema()).toContain("CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject)");
	});

	it("has index on facts(valid_from)", () => {
		expect(getSchema()).toContain(
			"CREATE INDEX IF NOT EXISTS idx_facts_valid_from ON facts(valid_from)",
		);
	});

	it("has index on facts(forgotten_at)", () => {
		expect(getSchema()).toContain(
			"CREATE INDEX IF NOT EXISTS idx_facts_forgotten ON facts(forgotten_at)",
		);
	});

	it("has index on facts(embedding_status)", () => {
		expect(getSchema()).toContain(
			"CREATE INDEX IF NOT EXISTS idx_facts_embedding_status ON facts(embedding_status)",
		);
	});

	it("has index on messages(conversation_id, created_at)", () => {
		expect(getSchema()).toContain(
			"CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at)",
		);
	});

	it("has index on summaries(conversation_id)", () => {
		expect(getSchema()).toContain(
			"CREATE INDEX IF NOT EXISTS idx_summaries_conversation ON summaries(conversation_id)",
		);
	});

	it("contains exactly 4 CREATE TABLE statements", () => {
		const matches = getSchema().match(/CREATE TABLE IF NOT EXISTS/g);
		expect(matches).toHaveLength(4);
	});

	it("contains exactly 6 CREATE INDEX statements", () => {
		const matches = getSchema().match(/CREATE INDEX IF NOT EXISTS/g);
		expect(matches).toHaveLength(6);
	});
});
