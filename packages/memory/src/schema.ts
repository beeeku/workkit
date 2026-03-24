export function getSchema(): string {
	return `
    CREATE TABLE IF NOT EXISTS facts (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      subject TEXT,
      source TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 1.0,
      encrypted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      valid_from INTEGER NOT NULL,
      valid_until INTEGER,
      superseded_by TEXT,
      forgotten_at INTEGER,
      forgotten_reason TEXT,
      embedding_status TEXT NOT NULL DEFAULT 'pending',
      ttl INTEGER,
      idempotency_key TEXT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS fact_embeddings (
      fact_id TEXT PRIMARY KEY REFERENCES facts(id),
      vector TEXT NOT NULL,
      dimensions INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      name TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      token_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      compacted_into TEXT
    );

    CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      content TEXT NOT NULL,
      message_range_from TEXT NOT NULL,
      message_range_to TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      original_tokens INTEGER NOT NULL,
      summary_tokens INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject);
    CREATE INDEX IF NOT EXISTS idx_facts_valid_from ON facts(valid_from);
    CREATE INDEX IF NOT EXISTS idx_facts_forgotten ON facts(forgotten_at);
    CREATE INDEX IF NOT EXISTS idx_facts_embedding_status ON facts(embedding_status);
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_summaries_conversation ON summaries(conversation_id);
  `;
}
