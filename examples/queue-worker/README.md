# Queue Worker

Queue producer/consumer with dead letter queue for background job processing.

## What it demonstrates

- **Typed producers** — `queue<EmailJob>(env.EMAIL_QUEUE)` gives you a typed `.send()` that only accepts `EmailJob` bodies. No more `any` payloads.
- **Per-message consumers** — `createConsumer` processes each message individually with automatic ack/retry. Return `RetryAction.RETRY`, `RetryAction.ACK`, or `RetryAction.DEAD_LETTER` for fine-grained control.
- **Dead letter queue** — Messages that exceed `maxRetries` are automatically forwarded to a DLQ. A separate `createDLQProcessor` handles failed messages with metadata (attempts, queue name, timestamp).
- **Concurrency control** — Process up to N messages in parallel within a single batch invocation.
- **Error classification** — Distinguish transient errors (retry) from permanent errors (DLQ) using `@workkit/errors`.

## Packages used

| Package | Purpose |
|---------|---------|
| `@workkit/queue` | Typed producers, consumers, and DLQ processors |
| `@workkit/env` | Environment binding validation |
| `@workkit/errors` | Error classification for retry decisions |

## Running locally

```bash
# Install dependencies
bun install

# Start local dev server (queues work locally with wrangler)
bun run dev
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/send` | Queue a single email job |
| POST | `/send-batch` | Queue multiple email jobs at once |

## Architecture

```
POST /send ──→ EMAIL_QUEUE ──→ Consumer
                                  │
                          success? ack
                          transient error? retry
                          permanent error? ──→ EMAIL_DLQ ──→ DLQ Processor ──→ alert
                          max retries? ──→ EMAIL_DLQ
```

## Example usage

```bash
# Send a single email
curl -X POST http://localhost:8787/send \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "welcome",
    "to": "user@example.com",
    "subject": "Welcome!",
    "templateId": "tmpl_welcome_v2",
    "data": {"name": "Alice"}
  }'

# Send a batch
curl -X POST http://localhost:8787/send-batch \
  -H 'Content-Type: application/json' \
  -d '[
    {"type": "notification", "to": "a@example.com", "subject": "Update", "templateId": "tmpl_notify"},
    {"type": "notification", "to": "b@example.com", "subject": "Update", "templateId": "tmpl_notify"}
  ]'
```
