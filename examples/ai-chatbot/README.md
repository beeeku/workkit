# AI Chatbot

Streaming AI chatbot with rate limiting, response caching, and multiple endpoints.

## What it demonstrates

- **Workers AI client** — `ai(env.AI)` wraps the raw AI binding with typed inference. `client.run()` returns `{ data, model }` instead of raw untyped output.
- **Streaming responses** — `streamAI()` returns a `ReadableStream` for Server-Sent Events. Tokens appear in real-time without waiting for the full response.
- **Sliding window rate limiting** — More accurate than fixed windows. `@workkit/ratelimit` adds standard `X-RateLimit-*` headers and returns proper `429` responses with `Retry-After`.
- **Stale-while-revalidate caching** — For FAQ-style queries, `swr()` returns cached answers instantly while refreshing in the background. Reduces AI inference costs for repeated questions.

## Packages used

| Package | Purpose |
|---------|---------|
| `@workkit/ai` | Typed Workers AI client and streaming |
| `@workkit/ratelimit` | Sliding window rate limiter with KV |
| `@workkit/cache` | SWR and cache-aside patterns |
| `@workkit/hono` | Hono integration for env validation |
| `@workkit/env` | Environment binding validation |

## Running locally

```bash
# Install dependencies
bun install

# Start local dev server (requires Workers AI access)
bun run dev
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat` | Send a message, receive full JSON response |
| POST | `/chat/stream` | Send a message, receive streaming SSE response |
| POST | `/chat/faq` | Send a question, receive cached response (SWR) |
| GET | `/models` | List available AI models |
| GET | `/health` | Health check |

## Example usage

```bash
# Standard chat
curl -X POST http://localhost:8787/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "What is Cloudflare Workers?"}'

# Streaming chat
curl -X POST http://localhost:8787/chat/stream \
  -H 'Content-Type: application/json' \
  -d '{"message": "Explain serverless computing"}'

# Cached FAQ (second call returns instantly)
curl -X POST http://localhost:8787/chat/faq \
  -H 'Content-Type: application/json' \
  -d '{"question": "What are your business hours?"}'
```

## Rate limiting

Each IP address is limited to 20 requests per minute on `/chat/*` endpoints. The response includes standard rate limit headers:

```
X-RateLimit-Limit: 20
X-RateLimit-Remaining: 17
X-RateLimit-Reset: 1711234567
```

When the limit is exceeded, a `429 Too Many Requests` response is returned with a `Retry-After` header.
