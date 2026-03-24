import { generateMessageId, estimateTokens } from "./utils";
import type {
  Conversation,
  ConversationMessage,
  StoredMessage,
  ConversationSnapshot,
  Summary,
  ConversationOptions,
  ConversationGetOptions,
  MessageListOptions,
  SummarizeOptions,
  MemoryResult,
} from "./types";

function parseMessage(row: any): StoredMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    name: row.name ?? null,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    tokenCount: row.token_count,
    createdAt: row.created_at,
    compactedInto: row.compacted_into ?? null,
  };
}

export function createConversation(id: string, db: D1Database, options?: ConversationOptions): Conversation {
  const tokenBudget = options?.tokenBudget ?? 4096;
  const windowSize = options?.windowSize ?? 50;

  return {
    id,

    async add(message: ConversationMessage): Promise<MemoryResult<StoredMessage>> {
      try {
        const msgId = generateMessageId();
        const tokens = estimateTokens(message.content);
        const now = Date.now();

        await db.prepare(
          `INSERT INTO messages (id, conversation_id, role, content, name, metadata, token_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          msgId,
          id,
          message.role,
          message.content,
          message.name ?? null,
          JSON.stringify(message.metadata ?? {}),
          tokens,
          now
        ).run();

        return {
          ok: true,
          value: {
            id: msgId,
            conversationId: id,
            role: message.role,
            content: message.content,
            name: message.name ?? null,
            metadata: message.metadata ?? {},
            tokenCount: tokens,
            createdAt: now,
            compactedInto: null,
          },
        };
      } catch (error: any) {
        return { ok: false, error: { code: "STORAGE_ERROR", message: error.message } };
      }
    },

    async get(opts?: ConversationGetOptions): Promise<MemoryResult<ConversationSnapshot>> {
      try {
        const budget = opts?.tokenBudget ?? tokenBudget;

        // Get recent messages (not compacted), DESC to get the most recent first
        const { results } = await db.prepare(
          `SELECT * FROM messages WHERE conversation_id = ? AND compacted_into IS NULL ORDER BY created_at DESC LIMIT ?`
        ).bind(id, windowSize).all();

        // Reverse to chronological order
        const messages = results.map(parseMessage).reverse();

        // Trim to token budget from the end (keep most recent within budget)
        let totalTokens = 0;
        const inBudget: StoredMessage[] = [];
        for (let i = messages.length - 1; i >= 0; i--) {
          if (totalTokens + messages[i].tokenCount > budget) break;
          totalTokens += messages[i].tokenCount;
          inBudget.unshift(messages[i]);
        }

        // Get total message count
        const countResult = await db.prepare(
          "SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?"
        ).bind(id).first<{ count: number }>();

        return {
          ok: true,
          value: {
            id,
            messages: inBudget,
            summaries: [],
            totalTokens,
            totalMessages: countResult?.count ?? 0,
            activeMessages: inBudget.length,
          },
        };
      } catch (error: any) {
        return { ok: false, error: { code: "STORAGE_ERROR", message: error.message } };
      }
    },

    async summarize(_options?: SummarizeOptions): Promise<MemoryResult<Summary>> {
      // Deferred to v0.2.0 (requires Workers AI)
      return { ok: false, error: { code: "COMPACTION_ERROR", message: "Summary compaction not yet implemented" } };
    },

    async clear(): Promise<MemoryResult<void>> {
      try {
        await db.prepare("DELETE FROM messages WHERE conversation_id = ?").bind(id).run();
        await db.prepare("DELETE FROM summaries WHERE conversation_id = ?").bind(id).run();
        return { ok: true, value: undefined };
      } catch (error: any) {
        return { ok: false, error: { code: "STORAGE_ERROR", message: error.message } };
      }
    },

    async messages(opts?: MessageListOptions): Promise<MemoryResult<StoredMessage[]>> {
      try {
        const limit = opts?.limit ?? 50;
        const offset = opts?.offset ?? 0;
        let sql = "SELECT * FROM messages WHERE conversation_id = ?";
        if (!opts?.includeCompacted) sql += " AND compacted_into IS NULL";
        sql += " ORDER BY created_at ASC LIMIT ? OFFSET ?";

        const { results } = await db.prepare(sql).bind(id, limit, offset).all();
        return { ok: true, value: results.map(parseMessage) };
      } catch (error: any) {
        return { ok: false, error: { code: "STORAGE_ERROR", message: error.message } };
      }
    },
  };
}
