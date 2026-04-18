---
"@workkit/ai-gateway": minor
---

**Route Anthropic and OpenAI through Cloudflare AI Gateway.** `createGateway` accepts a new top-level `cfGateway` option that rewrites the effective base URL for HTTP providers to `https://gateway.ai.cloudflare.com/v1/{accountId}/{gatewayId}/{provider}` and injects `cf-aig-*` request headers.

```ts
createGateway({
  providers: {
    anthropic: { type: "anthropic", apiKey: env.ANTHROPIC_KEY },
    openai: { type: "openai", apiKey: env.OPENAI_KEY },
  },
  cfGateway: {
    accountId: env.CF_ACCOUNT_ID,
    gatewayId: "my-gateway",
    authToken: env.CF_AIG_TOKEN, // → cf-aig-authorization
    cacheTtl: 3600,               // → cf-aig-cache-ttl
    skipCache: true,              // → cf-aig-skip-cache (emitted only when true)
  },
  defaultProvider: "anthropic",
});
```

Explicit `baseUrl` on a provider config still wins. Workers AI and custom providers are unaffected. Additive — no breaking changes.
