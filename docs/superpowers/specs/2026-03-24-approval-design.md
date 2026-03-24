# @workkit/approval — Approval-as-Infrastructure Design Spec

## Goal

A composable approval system for Cloudflare Workers that turns "ask permission before doing X" into a declarative infrastructure primitive. Define policies in code, gate any action (MCP tool calls, API mutations, financial operations), and get a full audit trail on D1 — all running at the edge with zero external dependencies.

**The bar:** Approval logic should be as easy to add as rate limiting. One factory call, declarative policies, middleware or standalone — developers should never build bespoke approval flows again.

## Design Principles

1. **Declarative over imperative** — Policies describe WHAT needs approval, not HOW to get it
2. **Composable** — Layers on @workkit/do, @workkit/d1, @workkit/queue, @workkit/crypto — never re-implements what exists
3. **Edge-native** — Entire lifecycle runs on Cloudflare: DO for state, D1 for audit, Queues for notifications, Alarms for timeouts
4. **Zero trust by default** — Requester cannot approve their own request. Tokens are single-use, time-bound, cryptographically signed.
5. **Observable** — Every state transition is an event. Full audit trail is immutable and queryable.
6. **Fail-closed** — If anything goes wrong (DO unavailable, policy evaluation error), the action is DENIED, never silently approved

## Architecture

### High-Level Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Request Path                                  │
│                                                                       │
│  Action ──► gate.guard() ──► Policy Engine ──► Match?                │
│                                                   │                   │
│                                    ┌──── No ──────┘──── Yes ────┐    │
│                                    ▼                             ▼    │
│                              Result.Ok()              Create Approval │
│                              (no policy)              Request (DO)    │
│                                                          │           │
│                                              ┌───────────┘           │
│                                              ▼                       │
│                                    ┌──────────────────┐              │
│                                    │  ApprovalRequest  │              │
│                                    │  Durable Object   │              │
│                                    │                   │              │
│                                    │  State Machine:   │              │
│                                    │  pending ──► approved            │
│                                    │    │   └──► denied               │
│                                    │    │   └──► escalated            │
│                                    │    └──────► timed_out            │
│                                    │                   │              │
│                                    │  Event Store:     │              │
│                                    │  (full audit log) │              │
│                                    │                   │              │
│                                    │  Alarm:           │              │
│                                    │  (timeout/escal.) │              │
│                                    └──────────────────┘              │
│                                              │                       │
│                              ┌───────────────┼───────────────┐       │
│                              ▼               ▼               ▼       │
│                         Notify Queue    Audit D1      Wait/Resume    │
│                              │                                       │
│                              ▼                                       │
│                    ┌─────────────────┐                               │
│                    │ Channel Adapters │                               │
│                    │ Webhook │ Email  │                               │
│                    │ Slack  │ Telegram│                               │
│                    └─────────────────┘                               │
└──────────────────────────────────────────────────────────────────────┘
```

### Approval Lifecycle

Each approval request follows a strict state machine:

```
                    ┌───────────┐
                    │  pending   │ ◄─── initial state
                    └─────┬─────┘
                          │
              ┌───────────┼───────────────┐
              │           │               │
              ▼           ▼               ▼
        ┌──────────┐ ┌──────────┐  ┌───────────┐
        │ approved │ │  denied  │  │ escalated │
        └──────────┘ └──────────┘  └─────┬─────┘
                                         │
                                   ┌─────┼─────┐
                                   ▼     ▼     ▼
                             approved  denied  timed_out

        pending ──► timed_out  (via DO alarm)
        pending ──► cancelled  (via requester or admin)
```

**Terminal states:** `approved`, `denied`, `timed_out`, `cancelled`

### State Machine Definition (on @workkit/do)

```ts
import { createStateMachine } from '@workkit/do'

type ApprovalState = 'pending' | 'approved' | 'denied' | 'escalated' | 'timed_out' | 'cancelled'

type ApprovalEvent =
  | { type: 'approve'; approverId: string; reason?: string }
  | { type: 'deny'; approverId: string; reason: string }
  | { type: 'escalate'; escalatedTo: string[]; reason: string }
  | { type: 'timeout' }
  | { type: 'cancel'; cancelledBy: string; reason?: string }

const approvalMachine = createStateMachine<ApprovalState, ApprovalEvent>({
  initial: 'pending',
  transitions: {
    pending: {
      approve: 'approved',
      deny: 'denied',
      escalate: 'escalated',
      timeout: 'timed_out',
      cancel: 'cancelled',
    },
    escalated: {
      approve: 'approved',
      deny: 'denied',
      timeout: 'timed_out',
      cancel: 'cancelled',
    },
  },
  onTransition: async (from, to, event, storage) => {
    // Event store append happens here — see Event Sourcing section
  },
})
```

### Event Sourcing for Audit (on @workkit/do)

Every approval request maintains its own event store within the DO. This is the ground truth — D1 is a queryable projection.

```ts
import { createEventStore } from '@workkit/do'

interface ApprovalAuditState {
  status: ApprovalState
  requestedBy: string
  requestedAt: number
  decisions: Array<{
    by: string
    action: 'approve' | 'deny'
    reason?: string
    at: number
  }>
  escalations: Array<{
    to: string[]
    reason: string
    at: number
  }>
}

type AuditEvent =
  | { type: 'request_created'; requestedBy: string; action: string; context: unknown }
  | { type: 'notification_sent'; channel: string; recipient: string }
  | { type: 'notification_failed'; channel: string; error: string }
  | { type: 'decision_made'; by: string; action: 'approve' | 'deny'; reason?: string }
  | { type: 'escalated'; to: string[]; reason: string }
  | { type: 'timed_out'; after: string }
  | { type: 'cancelled'; by: string; reason?: string }
  | { type: 'token_generated'; tokenId: string; expiresAt: number }
  | { type: 'token_consumed'; tokenId: string }
  | { type: 'token_expired'; tokenId: string }

const auditStore = createEventStore<ApprovalAuditState, AuditEvent>(storage, {
  initialState: {
    status: 'pending',
    requestedBy: '',
    requestedAt: 0,
    decisions: [],
    escalations: [],
  },
  reducer: (state, event) => {
    switch (event.type) {
      case 'request_created':
        return { ...state, requestedBy: event.requestedBy, requestedAt: Date.now() }
      case 'decision_made':
        return {
          ...state,
          status: event.action === 'approve' ? 'approved' : 'denied',
          decisions: [...state.decisions, { by: event.by, action: event.action, reason: event.reason, at: Date.now() }],
        }
      case 'escalated':
        return {
          ...state,
          status: 'escalated',
          escalations: [...state.escalations, { to: event.to, reason: event.reason, at: Date.now() }],
        }
      case 'timed_out':
        return { ...state, status: 'timed_out' }
      case 'cancelled':
        return { ...state, status: 'cancelled' }
      default:
        return state
    }
  },
  snapshotEvery: 20,
})
```

### DO Alarms for Timeouts and Escalation

Each approval request DO schedules alarms for:

1. **Timeout alarm** — fires when the approval window expires (e.g., 1h). Transitions to `timed_out` or executes `onTimeout` callback.
2. **Escalation alarm** — fires at escalation intervals (e.g., 15m). Sends notifications to escalation chain.

```ts
import { scheduleAlarm, createAlarmHandler } from '@workkit/do'

const alarmHandler = createAlarmHandler({
  actions: {
    'check-timeout': async (storage) => {
      const request = await storage.get<ApprovalRequestData>('request')
      if (!request) return

      const elapsed = Date.now() - request.createdAt
      if (elapsed >= request.timeoutMs) {
        // Transition to timed_out
        await machine.send({ type: 'timeout' }, storage)
        await auditStore.append({ type: 'timed_out', after: request.timeout })
        // Execute onTimeout callback if defined
        if (request.onTimeoutAction) {
          await notificationQueue.send({
            type: 'timeout_callback',
            requestId: request.id,
            action: request.onTimeoutAction,
          })
        }
      } else {
        // Check escalation
        const escalationIndex = Math.floor(elapsed / request.escalationIntervalMs)
        if (escalationIndex > request.currentEscalationLevel) {
          const nextApprovers = request.escalationChain[escalationIndex]
          if (nextApprovers) {
            await machine.send({
              type: 'escalate',
              escalatedTo: nextApprovers,
              reason: `No response after ${formatDuration(elapsed)}`,
            }, storage)
            await notificationQueue.send({
              type: 'escalation',
              requestId: request.id,
              approvers: nextApprovers,
            })
            await storage.put('request', {
              ...request,
              currentEscalationLevel: escalationIndex,
            })
          }
        }
        // Re-schedule for next check
        await scheduleAlarm(storage, { in: request.escalationIntervalMs < request.remainingMs
          ? `${Math.ceil(request.escalationIntervalMs / 60000)}m`
          : `${Math.ceil(request.remainingMs / 60000)}m`
        })
      }
    },
  },
})
```

### Notification Delivery via @workkit/queue

Notifications are fire-and-forget from the DO's perspective. The DO enqueues a notification message; a queue consumer handles delivery with retries and DLQ.

```ts
import { queue } from '@workkit/queue'

const notifications = queue<ApprovalNotification>(env.APPROVAL_NOTIFICATIONS)

// DO enqueues:
await notifications.send({
  type: 'approval_requested',
  requestId: 'apr_abc123',
  action: 'deploy:production',
  requestedBy: 'user:alice',
  approvers: ['user:bob', 'group:platform-team'],
  channels: ['slack', 'email'],
  context: { environment: 'production', service: 'api-v2' },
  approveUrl: 'https://api.example.com/approvals/apr_abc123/decide',
  token: '<signed-token>',
})
```

---

## Required wrangler.toml Configuration

The approval system uses Durable Objects for state management. You must export the DO classes and configure bindings in `wrangler.toml`:

```toml
# wrangler.toml

[[durable_objects.bindings]]
name = "APPROVAL_REQUESTS"
class_name = "ApprovalRequestDO"

[[migrations]]
tag = "v1"
new_classes = ["ApprovalRequestDO"]

# D1 for audit trail
[[d1_databases]]
binding = "DB"
database_name = "my-app-db"
database_id = "xxxx-xxxx-xxxx"

# Queue for notifications
[[queues.producers]]
binding = "APPROVAL_NOTIFICATIONS"
queue = "approval-notifications"

[[queues.consumers]]
queue = "approval-notifications"
max_retries = 5
dead_letter_queue = "approval-dlq"
```

In your worker entry point, re-export the DO class:

```ts
// worker.ts
export { ApprovalRequestDO } from '@workkit/approval'
```

---

## Complete API Surface

### Factory: `createApprovalGate`

The primary entry point. Creates a gate with bindings and configuration.

```ts
import { createApprovalGate } from '@workkit/approval'

interface ApprovalGateConfig {
  /** Durable Object namespace for approval request state */
  storage: DurableObjectNamespace

  /** D1 database for audit trail projection */
  audit: D1Database

  /** Queue for notification delivery */
  notificationQueue: Queue

  /** Signing key pair for approval tokens (base64-encoded Ed25519 keys).
   *  Accepts base64 strings suitable for env vars. The package imports them
   *  internally using @workkit/crypto importKey(). Use generateApprovalKeys()
   *  to generate a key pair. */
  signingKeys: {
    privateKey: string   // base64-encoded Ed25519 private key
    publicKey: string    // base64-encoded Ed25519 public key
  }

  /** Base URL for approval decision endpoints */
  baseUrl: string

  /** Logger instance (optional) */
  logger?: Logger

  /** Default timeout for approval requests (default: '1h') */
  defaultTimeout?: string

  /** Default escalation interval (default: '15m') */
  defaultEscalationInterval?: string

  /** Maximum pending approvals per requester (default: 100) */
  maxPendingPerRequester?: number

  /** Notification channel adapters */
  channels?: ChannelAdapter[]
}

function createApprovalGate(config: ApprovalGateConfig): ApprovalGate
```

### `generateApprovalKeys()`

Helper to generate a base64-encoded Ed25519 key pair suitable for environment variables:

```ts
import { generateApprovalKeys } from '@workkit/approval'

// Run once during setup, store results in env vars
const keys = await generateApprovalKeys()
// keys.privateKey: string (base64)
// keys.publicKey: string (base64)

// Set as env vars:
// APPROVAL_PRIVATE_KEY=<keys.privateKey>
// APPROVAL_PUBLIC_KEY=<keys.publicKey>

// In worker:
const gate = createApprovalGate({
  // ...
  signingKeys: {
    privateKey: env.APPROVAL_PRIVATE_KEY,
    publicKey: env.APPROVAL_PUBLIC_KEY,
  },
})
```

### `ApprovalGate` Interface

```ts
interface ApprovalGate {
  /**
   * Register a named policy.
   * Policies are evaluated in priority order (lowest number = highest priority).
   */
  policy(name: string, definition: PolicyDefinition): ApprovalGate

  /**
   * Hono middleware that gates MCP tool execution.
   * Suspends the request, creates an approval, and resumes on decision.
   */
  require(options?: RequireMiddlewareOptions): MiddlewareHandler

  /**
   * Standalone guard — evaluate policies and create approval if needed.
   * Returns immediately with a Result indicating whether to proceed.
   */
  guard(action: ActionDescriptor, context: GuardContext): AsyncResult<GuardResult, ApprovalError>

  /**
   * Submit a decision (approve/deny) for a pending request.
   * Verifies the signed token before accepting.
   */
  decide(
    requestId: ApprovalRequestId,
    decision: ApprovalDecision,
  ): AsyncResult<DecisionResult, ApprovalError>

  /**
   * Cancel a pending approval request.
   * Only the original requester or an admin can cancel.
   */
  cancel(
    requestId: ApprovalRequestId,
    cancelledBy: string,
    reason?: string,
  ): AsyncResult<void, ApprovalError>

  /**
   * Query pending approval requests.
   */
  listPending(options?: ListPendingOptions): AsyncResult<PaginatedResult<ApprovalRequestSummary>, ApprovalError>

  /**
   * Query completed approval requests (approved, denied, timed_out, cancelled).
   */
  listCompleted(options?: ListCompletedOptions): AsyncResult<PaginatedResult<ApprovalRequestSummary>, ApprovalError>

  /**
   * Get full audit trail for a specific request.
   */
  auditTrail(requestId: ApprovalRequestId): AsyncResult<AuditEntry[], ApprovalError>

  /**
   * Export audit data for compliance (date range, CSV/JSON).
   */
  exportAudit(options: ExportAuditOptions): AsyncResult<ReadableStream, ApprovalError>

  /**
   * Create a Hono router for the approval decision endpoint.
   * Mount this at your baseUrl path.
   */
  createRouter(): Hono
}
```

### Branded Types

```ts
import type { Branded } from '@workkit/types'

/** A unique approval request identifier */
type ApprovalRequestId = Branded<string, 'ApprovalRequestId'>

/** A unique approval token identifier */
type ApprovalTokenId = Branded<string, 'ApprovalTokenId'>

/** A unique policy identifier */
type PolicyId = Branded<string, 'PolicyId'>

// Constructors
function approvalRequestId(id: string): ApprovalRequestId
function approvalTokenId(id: string): ApprovalTokenId
function policyId(id: string): PolicyId
```

### Action Descriptor

Describes the action being gated. This is what policies match against.

```ts
interface ActionDescriptor {
  /** Action name or path (e.g., 'deploy:production', 'mcp:database-write', 'transfer:funds') */
  name: string

  /** Who is requesting this action */
  requestedBy: string

  /** Tags for policy matching (e.g., ['production', 'destructive', 'financial']) */
  tags?: string[]

  /** Estimated cost/impact for cost-based policies */
  cost?: {
    amount: number
    currency: string
  }

  /** Risk level for risk-based policies */
  risk?: 'low' | 'medium' | 'high' | 'critical'

  /** Arbitrary context passed to policy match functions and notification templates */
  metadata?: Record<string, unknown>
}
```

### Policy Definition

```ts
interface PolicyDefinition {
  /**
   * Predicate that determines if this policy applies to an action.
   * If multiple policies match, all must be satisfied (most restrictive wins).
   */
  match: PolicyMatcher

  /**
   * Who can approve requests matched by this policy.
   * Can be user IDs, group names, or a resolver function.
   */
  approvers: ApproverSpec

  /**
   * How many approvals are required.
   * Default: 1
   */
  requiredApprovals?: number

  /**
   * How long before the request times out.
   * Default: gate's defaultTimeout ('1h')
   */
  timeout?: string

  /**
   * What happens when the request times out.
   */
  onTimeout?: 'deny' | 'escalate' | 'auto-approve' | TimeoutCallback

  /**
   * Escalation chain — who to notify if no response within escalation intervals.
   * Each entry is a set of approvers notified at the next escalation level.
   */
  escalation?: ApproverSpec[]

  /**
   * Interval between escalation notifications.
   * Default: gate's defaultEscalationInterval ('15m')
   */
  escalationInterval?: string

  /**
   * Notification channels to use for this policy.
   * Default: all configured channels
   */
  channels?: string[]

  /**
   * Custom notification template overrides.
   */
  notificationTemplate?: NotificationTemplate

  /**
   * Priority — lower number = higher priority.
   * When multiple policies match, they are evaluated in priority order.
   * Default: 100
   */
  priority?: number

  /**
   * Whether the requester is explicitly forbidden from approving their own request.
   * Default: true (segregation of duties)
   */
  segregateRequester?: boolean

  /**
   * Additional validation before the approval is accepted.
   * Useful for time-of-day restrictions, IP allowlists, etc.
   */
  validateApproval?: (decision: ApprovalDecision, request: ApprovalRequestData) => Result<void, string>

  /**
   * Maximum age of the approval after it's granted.
   * After this duration, the approval is no longer valid even if it was approved.
   * Default: undefined (no expiry after approval)
   */
  approvalTTL?: string
}
```

### Policy Matcher

```ts
/**
 * Determines whether a policy applies to a given action.
 * Can be a simple object matcher or a custom predicate.
 */
type PolicyMatcher =
  | TagMatcher
  | CostMatcher
  | RiskMatcher
  | NameMatcher
  | CustomMatcher
  | CompositeMatcher

interface TagMatcher {
  type: 'tag'
  /** Action must have ALL of these tags */
  allOf?: string[]
  /** Action must have ANY of these tags */
  anyOf?: string[]
  /** Action must have NONE of these tags */
  noneOf?: string[]
}

interface CostMatcher {
  type: 'cost'
  /** Minimum cost threshold to trigger this policy (>= comparison) */
  greaterThanOrEqual: number
  /** Optional currency filter */
  currency?: string
}

interface RiskMatcher {
  type: 'risk'
  /** Minimum risk level to trigger this policy */
  minLevel: 'low' | 'medium' | 'high' | 'critical'
}

interface NameMatcher {
  type: 'name'
  /** Glob pattern against action name (e.g., 'deploy:*', 'mcp:database-*') */
  pattern: string
}

interface CustomMatcher {
  type: 'custom'
  /** Arbitrary predicate */
  fn: (action: ActionDescriptor) => boolean
}

interface CompositeMatcher {
  type: 'all' | 'any'
  matchers: PolicyMatcher[]
}
```

### Approver Spec

```ts
/**
 * Specifies who can approve a request.
 */
type ApproverSpec =
  | string[]                          // Literal user IDs
  | { group: string }                 // Named group (resolved at runtime)
  | { role: string }                  // Role-based (resolved at runtime)
  | { resolve: ApproverResolver }     // Dynamic resolution

type ApproverResolver = (
  action: ActionDescriptor,
  context: GuardContext,
) => Promise<string[]>
```

### Guard (Standalone Use)

```ts
interface GuardContext {
  /** The identity of the requester (user ID, service account, etc.) */
  identity: string

  /** Optional: pre-resolved approver list (skips resolver) */
  approvers?: string[]

  /** Optional: notification channel override */
  channels?: string[]

  /** Arbitrary context passed through to notifications and audit */
  metadata?: Record<string, unknown>
}

type GuardResult =
  | { status: 'allowed'; reason: 'no-policy-matched' }
  | { status: 'allowed'; reason: 'pre-approved'; approvalId: ApprovalRequestId }
  | { status: 'pending'; requestId: ApprovalRequestId; approvers: string[]; expiresAt: number }
  | { status: 'denied'; reason: string; deniedBy?: string }

// Usage:
const result = await gate.guard(
  {
    name: 'transfer:funds',
    requestedBy: 'user:alice',
    cost: { amount: 50000, currency: 'USD' },
    tags: ['financial', 'external'],
    metadata: { recipient: 'vendor-123', invoice: 'INV-456' },
  },
  { identity: 'user:alice' },
)

if (!result.ok) {
  // ApprovalError — system failure, not a denial
  throw result.error
}

switch (result.value.status) {
  case 'allowed':
    // Proceed with action
    break
  case 'pending':
    // Approval request created, waiting for decision
    // result.value.requestId can be used to poll or set up a callback
    break
  case 'denied':
    // Policy or previous decision denied this action
    break
}
```

### Gate Middleware (for Hono / @workkit/mcp)

```ts
interface RequireMiddlewareOptions {
  /**
   * Extract action descriptor from the request context.
   * Default: reads from c.get('approval:action') or derives from the route.
   */
  extractAction?: (c: Context) => ActionDescriptor

  /**
   * If true, blocks the request and waits for approval synchronously.
   * Returns the tool result directly once approved, or 403 on denial.
   * Uses SSE upgrade for real-time status updates while waiting.
   * This mode is intended for paid-tier deployments with long Worker execution limits.
   * Default: false (async mode — returns 202 immediately)
   */
  wait?: boolean

  /**
   * How long to wait for approval before returning 202 with a polling URL.
   * Only applies when `wait: true`.
   * Default: '30s'
   */
  waitTimeout?: string
}

// Usage as Hono middleware (default: async mode — returns 202 immediately):
const app = new Hono()

app.use('/admin/*', gate.require({
  extractAction: (c) => ({
    name: `admin:${c.req.method}:${c.req.path}`,
    requestedBy: c.get('userId'),
    tags: ['admin'],
  }),
  // Default behavior: returns 202 Accepted with requestId and polling URL.
  // The caller polls GET /approvals/:requestId for status.
}))

// Synchronous wait mode (paid-tier only — requires long Worker execution limits):
app.use('/critical/*', gate.require({
  wait: true,           // Block until decision
  waitTimeout: '30s',   // Fall back to 202 if no decision within 30s
  // Upgrades to SSE for real-time status updates while waiting
}))

// Usage with @workkit/mcp tool definition:
const tool = defineTool({
  name: 'database-drop',
  description: 'Drop a database table',
  parameters: z.object({ table: z.string() }),
  middleware: [
    gate.require({
      extractAction: (c) => ({
        name: 'mcp:database-drop',
        requestedBy: c.get('userId'),
        risk: 'critical',
        tags: ['destructive', 'database'],
        metadata: { table: c.req.param('table') },
      }),
    }),
  ],
  handler: async (c) => {
    // Only reached after approval
  },
})
```

### Approval Decision Endpoint

```ts
interface ApprovalDecision {
  /** The signed token proving this approver was authorized */
  token: string

  /** The decision */
  action: 'approve' | 'deny'

  /** Required for denials, optional for approvals */
  reason?: string

  /** Approver identity (verified against token) */
  approverId: string
}

interface DecisionResult {
  requestId: ApprovalRequestId
  newStatus: ApprovalState
  decidedBy: string
  decidedAt: number
  /** If multi-approver, how many more approvals are needed */
  remainingApprovals?: number
}

// The gate.createRouter() returns a Hono router with:
// POST /approvals/:requestId/decide  — submit a decision
// GET  /approvals/:requestId         — get request details + status
// GET  /approvals/:requestId/audit   — get audit trail
// GET  /approvals/pending            — list pending
// GET  /approvals/completed          — list completed
// POST /approvals/:requestId/cancel  — cancel a pending request
```

### Query API

```ts
interface ListPendingOptions {
  /** Filter by requester */
  requestedBy?: string
  /** Filter by approver (requests where this user can approve) */
  approverId?: string
  /** Filter by action name pattern */
  actionPattern?: string
  /** Filter by tags */
  tags?: string[]
  /** Pagination */
  cursor?: string
  limit?: number
}

interface ListCompletedOptions extends ListPendingOptions {
  /** Filter by status */
  status?: ('approved' | 'denied' | 'timed_out' | 'cancelled')[]
  /** Filter by date range */
  after?: Date
  before?: Date
}

interface PaginatedResult<T> {
  items: T[]
  cursor?: string
  hasMore: boolean
  total: number
}

interface ApprovalRequestSummary {
  id: ApprovalRequestId
  action: string
  requestedBy: string
  requestedAt: number
  status: ApprovalState
  approvers: string[]
  requiredApprovals: number
  currentApprovals: number
  expiresAt: number
  policyName: string
  metadata?: Record<string, unknown>
}

interface AuditEntry {
  id: number
  requestId: ApprovalRequestId
  eventType: string
  actor?: string
  details: Record<string, unknown>
  timestamp: number
}

interface ExportAuditOptions {
  /** Start of date range */
  after: Date
  /** End of date range */
  before: Date
  /** Export format */
  format: 'json' | 'csv'
  /** Filter by action pattern */
  actionPattern?: string
  /** Filter by status */
  status?: ApprovalState[]
}
```

---

## Policy Engine

### Policy Evaluation

When `gate.guard()` or `gate.require()` is called:

1. **Collect all policies** — both code-defined (via `gate.policy()`) and dynamic (from KV/D1).
2. **Sort by priority** — lowest number first.
3. **Evaluate matchers** — test each policy's `match` against the `ActionDescriptor`.
4. **Collect matching policies** — all policies where `match` returns true.
5. **Apply most-restrictive-wins** — if ANY matching policy has `requiredApprovals > 0`, approval is required. The highest `requiredApprovals`, shortest `timeout`, and strictest `segregateRequester` across all matching policies apply.
6. **Merge approver sets** — union of all approvers from matching policies. If multi-approver, each approval must come from a different person.
7. **No match = allowed** — if no policies match, the action proceeds (unless a default catch-all policy is defined).

```ts
// Policy evaluation internals
interface ResolvedPolicy {
  name: string
  priority: number
  requiredApprovals: number
  timeout: number
  approvers: string[]
  segregateRequester: boolean
  escalation: string[][]
  escalationInterval: number
  onTimeout: 'deny' | 'escalate' | 'auto-approve' | TimeoutCallback
  channels: string[]
  approvalTTL?: number
  validateApproval?: (decision: ApprovalDecision, request: ApprovalRequestData) => Result<void, string>
}

function evaluatePolicies(
  action: ActionDescriptor,
  policies: Map<string, PolicyDefinition>,
  dynamicPolicies: PolicyDefinition[],
): ResolvedPolicy | null {
  const matches: Array<{ name: string; policy: PolicyDefinition }> = []

  // Evaluate all policies
  for (const [name, policy] of policies) {
    if (matchesPolicy(action, policy.match)) {
      matches.push({ name, policy })
    }
  }
  for (const policy of dynamicPolicies) {
    if (matchesPolicy(action, policy.match)) {
      matches.push({ name: `dynamic:${policy.priority}`, policy })
    }
  }

  if (matches.length === 0) return null

  // Sort by priority
  matches.sort((a, b) => (a.policy.priority ?? 100) - (b.policy.priority ?? 100))

  // Merge: most restrictive wins
  return mergeMatchingPolicies(matches)
}
```

### Policy Matching Implementation

```ts
function matchesPolicy(action: ActionDescriptor, matcher: PolicyMatcher): boolean {
  switch (matcher.type) {
    case 'tag': {
      const tags = action.tags ?? []
      if (matcher.allOf && !matcher.allOf.every(t => tags.includes(t))) return false
      if (matcher.anyOf && !matcher.anyOf.some(t => tags.includes(t))) return false
      if (matcher.noneOf && matcher.noneOf.some(t => tags.includes(t))) return false
      return true
    }
    case 'cost': {
      if (!action.cost) return false
      if (matcher.currency && action.cost.currency !== matcher.currency) return false
      return action.cost.amount >= matcher.greaterThanOrEqual
    }
    case 'risk': {
      if (!action.risk) return false
      const levels = ['low', 'medium', 'high', 'critical']
      return levels.indexOf(action.risk) >= levels.indexOf(matcher.minLevel)
    }
    case 'name': {
      return globMatch(matcher.pattern, action.name)
    }
    case 'custom': {
      return matcher.fn(action)
    }
    case 'all': {
      return matcher.matchers.every(m => matchesPolicy(action, m))
    }
    case 'any': {
      return matcher.matchers.some(m => matchesPolicy(action, m))
    }
  }
}
```

### Default (Catch-All) Policy

```ts
// Registered with a special name
gate.policy('default', {
  match: { type: 'custom', fn: () => true },
  approvers: { role: 'admin' },
  requiredApprovals: 1,
  timeout: '2h',
  onTimeout: 'deny',
  priority: 999, // Lowest priority — only fires if nothing else matches
})
```

### Dynamic Policies (KV/D1)

Policies can be loaded from KV (for hot-path lookups) or D1 (for complex policy management).

```ts
interface DynamicPolicySource {
  /** Load policies from an external source */
  load(): Promise<PolicyDefinition[]>
  /** Cache TTL for loaded policies */
  cacheTTL?: string
}

// KV-backed dynamic policies
const kvPolicies: DynamicPolicySource = {
  async load() {
    const raw = await kv(env.POLICIES).get<PolicyDefinition[]>('approval-policies')
    return raw ?? []
  },
  cacheTTL: '5m',
}

// Register dynamic source
const gate = createApprovalGate({
  // ...bindings...
  dynamicPolicies: kvPolicies,
})
```

**Dynamic policy schema (stored in KV/D1):**

```ts
interface StoredPolicy {
  name: string
  match: {
    type: 'tag' | 'cost' | 'risk' | 'name'
    // Match-type-specific fields (no custom functions — not serializable)
    allOf?: string[]
    anyOf?: string[]
    noneOf?: string[]
    greaterThanOrEqual?: number
    currency?: string
    minLevel?: string
    pattern?: string
  }
  approvers: string[] | { group: string } | { role: string }
  requiredApprovals?: number
  timeout?: string
  onTimeout?: 'deny' | 'escalate' | 'auto-approve'
  escalation?: Array<string[] | { group: string } | { role: string }>
  priority?: number
  segregateRequester?: boolean
  approvalTTL?: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}
```

Note: Dynamic policies cannot use `custom` matchers or function-based `validateApproval` since functions are not serializable. These features are code-only.

---

## Notification System

### Channel Adapter Interface

```ts
interface ChannelAdapter {
  /** Unique name for this channel (e.g., 'slack', 'email', 'webhook') */
  name: string

  /**
   * Send a notification.
   * Returns Ok on success, Err on failure (triggers queue retry).
   */
  send(notification: NotificationPayload): AsyncResult<void, ChannelError>
}

interface NotificationPayload {
  /** Type of notification */
  type: 'approval_requested' | 'approval_decided' | 'approval_escalated' | 'approval_timed_out'

  /** The approval request data */
  request: ApprovalRequestSummary

  /** Recipients for this notification */
  recipients: string[]

  /** URL for the approver to make their decision */
  decisionUrl: string

  /** Pre-generated approve/deny URLs with embedded tokens */
  approveUrl: string
  denyUrl: string

  /** Custom template data */
  templateData?: Record<string, unknown>
}

/** Extends WorkkitError with code 'APPROVAL_CHANNEL_FAILURE' */
class ChannelError extends WorkkitError {
  readonly code = 'APPROVAL_CHANNEL_FAILURE'
  readonly channel: string
  readonly retryable: boolean

  constructor(channel: string, message: string, retryable: boolean) {
    super(message)
    this.channel = channel
    this.retryable = retryable
  }
}
```

### Built-in Channel Adapters

#### Webhook Adapter

```ts
import { createWebhookChannel } from '@workkit/approval/channels'

const webhook = createWebhookChannel({
  url: 'https://hooks.example.com/approvals',
  /** Optional: sign payloads with HMAC for verification */
  signingSecret?: string,
  /** Optional: custom headers */
  headers?: Record<string, string>,
  /** Optional: timeout */
  timeout?: string, // default: '10s'
})
```

#### Email Adapter (via Cloudflare Email Workers)

```ts
import { createEmailChannel } from '@workkit/approval/channels'

const email = createEmailChannel({
  /** Email Workers binding */
  emailBinding: env.EMAIL,
  /** From address */
  from: 'approvals@example.com',
  /** Resolve user IDs to email addresses */
  resolveEmail: async (userId: string) => {
    const user = await db.first<{ email: string }>('SELECT email FROM users WHERE id = ?', [userId])
    return user?.email ?? null
  },
  /** Optional: custom subject template */
  subjectTemplate?: (request: ApprovalRequestSummary) => string,
})
```

#### Slack Adapter

```ts
import { createSlackChannel } from '@workkit/approval/channels'

const slack = createSlackChannel({
  /** Slack Bot OAuth token */
  token: env.SLACK_TOKEN,
  /** Default channel for notifications */
  defaultChannel: '#approvals',
  /** Resolve user IDs to Slack user IDs */
  resolveSlackUser: async (userId: string) => {
    // return Slack user ID or channel ID
  },
  /** Use Block Kit interactive messages with approve/deny buttons */
  interactive: true,
})
```

#### Telegram Adapter

```ts
import { createTelegramChannel } from '@workkit/approval/channels'

const telegram = createTelegramChannel({
  /** Telegram Bot token */
  token: env.TELEGRAM_TOKEN,
  /** Default chat ID */
  chatId: env.TELEGRAM_CHAT_ID,
  /** Resolve user IDs to Telegram chat IDs */
  resolveChatId: async (userId: string) => {
    // return Telegram user/chat ID
  },
  /** Use inline keyboards with approve/deny buttons */
  interactive: true,
})
```

#### Custom Channel

```ts
const custom: ChannelAdapter = {
  name: 'pagerduty',
  async send(notification) {
    const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        routing_key: env.PAGERDUTY_KEY,
        event_action: 'trigger',
        payload: {
          summary: `Approval required: ${notification.request.action}`,
          severity: 'warning',
          source: 'workkit-approval',
          custom_details: notification.request.metadata,
        },
      }),
    })
    if (!response.ok) {
      return Err({ channel: 'pagerduty', message: `HTTP ${response.status}`, retryable: response.status >= 500 })
    }
    return Ok(undefined)
  },
}
```

### Notification Content

Every notification includes:

| Field | Description |
|-------|-------------|
| `requestId` | Unique approval request ID |
| `action` | What's being requested (human-readable) |
| `requestedBy` | Who's asking |
| `requestedAt` | When (ISO timestamp) |
| `expiresAt` | When the request times out |
| `approvers` | Who can approve |
| `requiredApprovals` | How many approvals needed |
| `currentApprovals` | How many already received |
| `metadata` | Custom context (environment, cost, etc.) |
| `decisionUrl` | URL to approve/deny |
| `approveUrl` | One-click approve (token embedded) |
| `denyUrl` | One-click deny (token embedded) |

### Notification Templates

```ts
interface NotificationTemplate {
  /** Override the notification title/subject */
  title?: (request: ApprovalRequestSummary) => string

  /** Override the notification body */
  body?: (request: ApprovalRequestSummary, urls: { approve: string; deny: string; details: string }) => string

  /** Override for escalation notifications */
  escalationBody?: (request: ApprovalRequestSummary, escalationLevel: number) => string
}
```

### Retry on Notification Failure

Notification delivery uses @workkit/queue with built-in retry:

```ts
import { createConsumer } from '@workkit/queue'

const notificationConsumer = createConsumer<ApprovalNotification>({
  async process(message) {
    const notification = message.body
    const channel = channels.find(c => c.name === notification.channel)

    if (!channel) {
      // Unknown channel — send to DLQ
      return RetryAction.DEAD_LETTER
    }

    const result = await channel.send(notification.payload)
    if (!result.ok) {
      if (result.error.retryable) {
        return RetryAction.RETRY
      }
      // Non-retryable failure — log and DLQ
      return RetryAction.DEAD_LETTER
    }

    // Record notification success in audit
    await auditProjection.recordNotification(notification.requestId, notification.channel, 'sent')
    return RetryAction.ACK
  },
  maxRetries: 5,
  deadLetterQueue: env.APPROVAL_DLQ,
})
```

### Notification Grouping

For batch operations (e.g., 20 file deletions that all need approval), the gate detects concurrent requests from the same requester with the same policy and groups them:

```ts
interface NotificationGrouping {
  /** Enable grouping (default: true) */
  enabled?: boolean

  /** Window for grouping concurrent requests (default: '5s') */
  groupWindow?: string

  /** Maximum requests per group notification (default: 20) */
  maxGroupSize?: number
}
```

When grouping is active, the notification queue consumer holds messages for the group window, then sends a single digest notification:

```
"Alice requested approval for 12 actions:
  - deploy:production (api-v2)
  - deploy:production (web-frontend)
  - deploy:production (worker-cron)
  ...
[Approve All] [Review Individually] [Deny All]"
```

---

## Approval Token Security

### Token Structure

Approval tokens are compact, cryptographically signed payloads that prove an approver is authorized to make a decision on a specific request.

```ts
interface ApprovalTokenPayload {
  /** Token version (for future schema changes) */
  v: 1

  /** Unique token ID (for one-time-use tracking) */
  tid: string

  /** The approval request this token authorizes */
  rid: string

  /** The specific approver this token was issued for */
  sub: string

  /** The permitted action ('approve' | 'deny' | 'both') */
  act: 'approve' | 'deny' | 'both'

  /** Token expiry (Unix timestamp, seconds) */
  exp: number

  /** Token issued-at (Unix timestamp, seconds) */
  iat: number

  /** Nonce for replay prevention */
  nonce: string
}
```

### Token Generation

```ts
import { sign, randomUUID } from '@workkit/crypto'

async function generateApprovalToken(
  requestId: string,
  approverId: string,
  action: 'approve' | 'deny' | 'both',
  expiresIn: number, // milliseconds
  privateKey: CryptoKey, // imported internally from base64 config string via @workkit/crypto importKey()
): Promise<{ token: string; tokenId: string }> {
  const now = Math.floor(Date.now() / 1000)
  const tokenId = randomUUID()
  const nonce = randomUUID()

  const payload: ApprovalTokenPayload = {
    v: 1,
    tid: tokenId,
    rid: requestId,
    sub: approverId,
    act: action,
    exp: now + Math.floor(expiresIn / 1000),
    iat: now,
    nonce,
  }

  // Sign the payload with Ed25519
  const signature = await sign(privateKey, payload)

  // Token = base64url(JSON(payload)) + '.' + signature
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  return {
    token: `${encodedPayload}.${signature}`,
    tokenId,
  }
}
```

### Token Verification on Decision Submission

```ts
import { sign } from '@workkit/crypto'

async function verifyApprovalToken(
  token: string,
  expectedRequestId: string,
  expectedApproverId: string,
  publicKey: CryptoKey,
  consumedTokens: Set<string>, // from DO storage
): Promise<Result<ApprovalTokenPayload, TokenError>> {
  // 1. Parse token
  const [encodedPayload, signature] = token.split('.')
  if (!encodedPayload || !signature) {
    return Err({ code: 'MALFORMED_TOKEN', message: 'Token must be payload.signature' })
  }

  // 2. Decode payload
  let payload: ApprovalTokenPayload
  try {
    const json = atob(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'))
    payload = JSON.parse(json)
  } catch {
    return Err({ code: 'INVALID_PAYLOAD', message: 'Cannot decode token payload' })
  }

  // 3. Verify signature
  const isValid = await sign.verify(publicKey, payload, signature)
  if (!isValid) {
    return Err({ code: 'INVALID_SIGNATURE', message: 'Token signature verification failed' })
  }

  // 4. Check expiry
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp <= now) {
    return Err({ code: 'TOKEN_EXPIRED', message: `Token expired at ${new Date(payload.exp * 1000).toISOString()}` })
  }

  // 5. Check request ID
  if (payload.rid !== expectedRequestId) {
    return Err({ code: 'REQUEST_MISMATCH', message: 'Token was issued for a different request' })
  }

  // 6. Check approver
  if (payload.sub !== expectedApproverId) {
    return Err({ code: 'APPROVER_MISMATCH', message: 'Token was issued for a different approver' })
  }

  // 7. One-time use check
  if (consumedTokens.has(payload.tid)) {
    return Err({ code: 'TOKEN_ALREADY_USED', message: 'This approval token has already been consumed' })
  }

  return Ok(payload)
}
```

### One-Time Use Enforcement

Consumed token IDs are stored in the DO alongside the approval request:

```ts
// In the ApprovalRequest DO:
const consumed = await storage.get<string[]>('consumed_tokens') ?? []
if (consumed.includes(payload.tid)) {
  return Err({ code: 'TOKEN_ALREADY_USED', message: 'Token already consumed' })
}

// After successful decision:
consumed.push(payload.tid)
await storage.put('consumed_tokens', consumed)
```

### Replay Attack Prevention

Multiple layers prevent replay:

1. **One-time use** — Token ID tracked in DO storage. Second use is rejected.
2. **Short expiry** — Tokens expire with the approval request timeout (typically 1h or less).
3. **Nonce** — Random nonce prevents prediction of valid token IDs.
4. **Request binding** — Token is bound to a specific request ID. Cannot be used for a different request.
5. **Approver binding** — Token is bound to a specific approver. Cannot be forwarded.
6. **State check** — The DO verifies the request is still in `pending` or `escalated` state before accepting a decision. A token for a request that's already `approved`, `denied`, or `timed_out` is rejected.

---

## Edge Cases & Error Handling

### DO Storage Capacity

**Problem:** DO storage has a 128 KB per-key limit and 10 GB total limit. If many approval requests accumulate, the event store could grow large.

**Mitigation:**
- Event store snapshots every 20 events, keeping the replay window small.
- Completed requests are archived to D1 after a configurable retention period (default: 7 days).
- A periodic alarm in the DO prunes old events and snapshots.
- The `maxPendingPerRequester` config (default: 100) prevents a single user from flooding the system.

```ts
// Archival alarm action
'archive-completed': async (storage) => {
  const request = await storage.get<ApprovalRequestData>('request')
  if (!request) return
  if (!isTerminalState(request.status)) return

  const age = Date.now() - request.completedAt
  if (age < retentionMs) {
    // Re-schedule
    await scheduleAlarm(storage, { in: `${Math.ceil((retentionMs - age) / 3600000)}h` })
    return
  }

  // Archive full event log to D1
  const events = await auditStore.getEvents()
  await archiveToD1(request, events)

  // Clean up DO storage
  await storage.deleteAll()
}
```

### Notification Channel Down

**Problem:** Slack/email/webhook is unavailable when an approval request is created.

**Mitigation:**
- Notifications go through @workkit/queue with `maxRetries: 5` and exponential backoff.
- Failed notifications go to DLQ after exhausting retries.
- The approval request is still created and functional — the approver can still access it via the decision URL if they know about it.
- A `notification_failed` event is appended to the audit store.
- The escalation alarm will re-send notifications to the escalation chain, providing another opportunity for delivery.

### Token Expiry Mid-Decision

**Problem:** An approver clicks "Approve" in their email, but their token has expired by the time the request reaches the server.

**Response:**
- Return a clear error: `TOKEN_EXPIRED` with the expiry timestamp.
- Include a link to the approval details page where the approver can request a fresh token.
- If the request is still pending, the gate can issue a new token on demand (via the details page, authenticated by the approver's session).

```ts
// In the decision endpoint:
if (tokenResult.error.code === 'TOKEN_EXPIRED') {
  return c.json({
    error: 'TOKEN_EXPIRED',
    message: 'Your approval link has expired.',
    requestStatus: request.status, // Show current status
    renewUrl: request.status === 'pending'
      ? `${baseUrl}/approvals/${requestId}/renew?approver=${approverId}`
      : null,
  }, 410) // 410 Gone
}
```

### Concurrent Multi-Approver Decisions

**Problem:** Two approvers click "Approve" at the same time on a request requiring 2 approvals.

**Mitigation:**
- The DO is the single coordination point. All decisions go through the same DO instance (Cloudflare guarantees single-threaded execution within a DO).
- Each decision is processed sequentially within the DO.
- The approval count is checked atomically: `currentApprovals + 1 >= requiredApprovals`.
- Both approvers receive a success response, but only the one that crosses the threshold triggers the state transition to `approved`.

```ts
// Inside the DO:
async function handleDecision(decision: ApprovalDecision): Promise<DecisionResult> {
  const request = await storage.get<ApprovalRequestData>('request')

  // State check — must be pending or escalated
  if (!['pending', 'escalated'].includes(request.status)) {
    throw new ApprovalError('REQUEST_NOT_PENDING', `Request is already ${request.status}`)
  }

  // Segregation check
  if (request.segregateRequester && decision.approverId === request.requestedBy) {
    throw new ApprovalError('SELF_APPROVAL', 'You cannot approve your own request')
  }

  // Duplicate check — same approver already decided
  if (request.decisions.some(d => d.by === decision.approverId)) {
    throw new ApprovalError('ALREADY_DECIDED', 'You have already submitted a decision for this request')
  }

  // Record the decision
  request.decisions.push({
    by: decision.approverId,
    action: decision.action,
    reason: decision.reason,
    at: Date.now(),
  })

  const approvalCount = request.decisions.filter(d => d.action === 'approve').length
  const denyCount = request.decisions.filter(d => d.action === 'deny').length

  // Check if we've reached the threshold
  if (decision.action === 'approve' && approvalCount >= request.requiredApprovals) {
    await machine.send({ type: 'approve', approverId: decision.approverId, reason: decision.reason }, storage)
    request.status = 'approved'
    request.completedAt = Date.now()
  } else if (decision.action === 'deny') {
    // Any single denial denies the whole request
    await machine.send({ type: 'deny', approverId: decision.approverId, reason: decision.reason! }, storage)
    request.status = 'denied'
    request.completedAt = Date.now()
  }

  await storage.put('request', request)

  return {
    requestId: approvalRequestId(request.id),
    newStatus: request.status,
    decidedBy: decision.approverId,
    decidedAt: Date.now(),
    remainingApprovals: Math.max(0, request.requiredApprovals - approvalCount),
  }
}
```

### Original Tool Call Timeout Before Approval

**Problem:** The HTTP request may time out while waiting for approval (Cloudflare Workers has a default execution limit).

**Mitigation:**
- The `require()` middleware defaults to **async mode** — returns `202 Accepted` immediately with the `requestId` and a polling URL. No timeout concern.
- For synchronous wait mode (`wait: true`), the `waitTimeout` (default: `30s`) is the maximum blocking time. If no decision arrives, the middleware falls back to the async 202 response.
- The MCP integration uses SSE-based progress notifications (see Integration section) for real-time status updates.

```ts
// In middleware (default async mode):
if (!options.wait) {
  // Async mode — return 202 immediately
  return c.json({
    status: 'pending',
    requestId,
    message: 'Approval pending. Poll for status.',
    pollUrl: `${baseUrl}/approvals/${requestId}`,
  }, 202)
}

// Synchronous wait mode (opt-in via `wait: true`):
const decision = await Promise.race([
  waitForDecision(requestId),
  sleep(waitTimeoutMs).then(() => null),
])

if (decision === null) {
  // Timeout — fall back to async response
  return c.json({
    status: 'pending',
    requestId,
    message: 'Approval pending. Check back later.',
    pollUrl: `${baseUrl}/approvals/${requestId}`,
  }, 202)
}

if (decision.status === 'denied') {
  return c.json({
    status: 'denied',
    requestId,
    reason: decision.reason,
    deniedBy: decision.decidedBy,
  }, 403)
}

// Approved — continue to handler
await next()
```

### Server Restart While Approval Pending

**Non-issue.** This is the whole point of using Durable Objects.

- Approval request state lives in DO storage, which is persistent and replicated.
- Event store, state machine state, pending token IDs — all in DO storage.
- The DO alarm (for timeout/escalation) survives restarts. Cloudflare re-invokes the alarm at the scheduled time.
- The D1 audit projection is eventually consistent. If the projection write fails, the DO event store is the source of truth and can be re-projected.

### Approver Tries to Approve After Denying

**Problem:** An approver denied a request, then changes their mind and tries to approve.

**Response:** Rejected. The `ALREADY_DECIDED` check prevents the same approver from submitting multiple decisions. This is a compliance requirement — decisions are immutable. If the approver needs to change their decision:
1. The original request must be cancelled.
2. The requester must submit a new request.
3. The approver can now approve the new request.

The audit trail records both the original denial and the new approval on separate requests, providing a clear paper trail.

### Audit Trail Integrity

**Problem:** Can the audit trail be tampered with?

**Defense in depth:**

1. **DO Event Store (primary):** Append-only. Events are keyed by monotonically increasing sequence numbers. The `createEventStore` from @workkit/do does not expose a delete or update method for individual events. Tampering requires direct DO storage access (admin-level).

2. **D1 Projection (secondary):** Each audit row includes:
   - `event_hash`: SHA-256 hash of the event payload
   - `chain_hash`: SHA-256 hash of `previous_chain_hash + event_hash` (hash chain)
   - `signature`: Ed25519 signature of the `chain_hash` by the gate's signing key

```ts
interface AuditRow {
  id: number
  request_id: string
  event_type: string
  event_payload: string // JSON
  event_hash: string    // SHA-256 of event_payload
  chain_hash: string    // SHA-256 of (prev_chain_hash + event_hash)
  signature: string     // Ed25519 sign(chain_hash)
  created_at: number
}
```

3. **Verification endpoint:** `GET /approvals/audit/verify?after=<date>&before=<date>` walks the hash chain and verifies signatures. Any gap or mismatch is flagged.

### Approval Loops

**Problem:** Tool A requires approval. The approval check calls Tool B (e.g., to resolve approvers from a database). Tool B also requires approval. Infinite loop.

**Mitigation:**

1. **Internal context flag:** The gate sets a `__approval_internal` flag on the execution context when making internal calls (like approver resolution). Policies that check this flag skip approval for internal operations.

2. **Depth counter:** Each `guard()` call increments a depth counter in the context. If depth exceeds `maxDepth` (default: 3), the gate returns `Err('APPROVAL_LOOP_DETECTED')`.

3. **Design guidance:** Approver resolvers should use direct D1/KV reads, not gated tool calls.

```ts
// Internal — the gate checks this before evaluating policies
interface InternalContext {
  __approval_depth: number
  __approval_internal: boolean
}

// In guard():
if (context.__approval_internal || (context.__approval_depth ?? 0) >= maxDepth) {
  return Ok({ status: 'allowed', reason: 'internal-bypass' })
}
```

### Memory Pressure from Pending Approvals

**Problem:** Each pending approval is a separate DO instance. With many pending approvals, DO instantiation costs could add up.

**Mitigation:**
- DOs are only instantiated when accessed (decision submission, status check, alarm firing). Idle DOs are evicted.
- The `maxPendingPerRequester` limit (default: 100) caps total pending requests per user.
- A global limit can be enforced via a coordination DO that tracks pending count:

```ts
interface ApprovalCounterSchema {
  pendingCount: number
  perRequester: Record<string, number>
}

// Before creating a new approval request:
const counter = singleton(env.APPROVAL_COUNTER, 'global')
const canCreate = await counter.tryIncrement(requestedBy, maxPendingPerRequester, maxGlobalPending)
if (!canCreate) {
  return Err(new ApprovalError('TOO_MANY_PENDING', 'Maximum pending approvals reached'))
}
```

### Clock Skew Between DO Instances

**Non-issue for Cloudflare.** Each approval request runs on a single DO instance — there's no multi-instance coordination for a single request. Timeout calculations use `Date.now()` within the DO, which is consistent within a single invocation. The DO alarm scheduler uses Cloudflare's internal clock, which may have minor skew vs. `Date.now()`, but the consequence is at most a few seconds of timeout imprecision — acceptable for human-scale approval workflows.

For token expiry verification, a configurable `clockSkewTolerance` (default: 30 seconds) is applied:

```ts
if (payload.exp + clockSkewToleranceSeconds <= now) {
  return Err({ code: 'TOKEN_EXPIRED', ... })
}
```

---

## Compliance Features

### Immutable Audit Trail

The D1 audit table schema:

```sql
CREATE TABLE approval_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT,
  event_payload TEXT NOT NULL,         -- JSON
  event_hash TEXT NOT NULL,            -- SHA-256
  chain_hash TEXT NOT NULL,            -- SHA-256(prev + current)
  signature TEXT NOT NULL,             -- Ed25519 of chain_hash
  created_at INTEGER NOT NULL,         -- Unix ms

  -- Indexes for common queries
  CONSTRAINT fk_request FOREIGN KEY (request_id) REFERENCES approval_requests(id)
);

CREATE INDEX idx_audit_request ON approval_audit(request_id);
CREATE INDEX idx_audit_type ON approval_audit(event_type);
CREATE INDEX idx_audit_actor ON approval_audit(actor);
CREATE INDEX idx_audit_created ON approval_audit(created_at);

CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL,
  policy_name TEXT NOT NULL,
  required_approvals INTEGER NOT NULL DEFAULT 1,
  current_approvals INTEGER NOT NULL DEFAULT 0,
  metadata TEXT,                        -- JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_requests_status ON approval_requests(status);
CREATE INDEX idx_requests_requester ON approval_requests(requested_by);
CREATE INDEX idx_requests_action ON approval_requests(action);
CREATE INDEX idx_requests_created ON approval_requests(created_at);
```

### Approval Reports

```ts
// Generate a compliance report for a date range
const report = await gate.exportAudit({
  after: new Date('2026-03-01'),
  before: new Date('2026-03-31'),
  format: 'json',
})

// Report includes:
// - Total requests (by status breakdown)
// - Average approval time
// - Approver activity (who approved what, how many)
// - Policy hit rates (which policies triggered most)
// - Timeout/escalation statistics
// - Segregation of duties violations (if any were attempted)
```

### Segregation of Duties

Enforced at two levels:

1. **Policy level:** `segregateRequester: true` (default) prevents the requester from approving their own request.
2. **Token level:** Tokens are bound to a specific approver ID. The requester's ID is excluded from token generation.
3. **Audit level:** Even if bypassed (by setting `segregateRequester: false`), a `self_approval` flag is recorded in the audit event for compliance review.

### Time-Bound Approvals

```ts
gate.policy('production-deploy', {
  match: { type: 'tag', allOf: ['production', 'deploy'] },
  approvers: { group: 'platform-team' },
  timeout: '1h',
  // The approval itself expires 15 minutes after being granted
  approvalTTL: '15m',
})

// When checking if an action was previously approved:
const previousApproval = await gate.guard(action, context)
// If the approval was granted 20 minutes ago but approvalTTL is 15m,
// it returns { status: 'pending' } — a new approval is required.
```

### Revocation

```ts
// Cancel a pending approval (requester or admin)
const result = await gate.cancel(
  approvalRequestId('apr_abc123'),
  'user:alice',
  'No longer needed — deploying a different version',
)

// The cancellation:
// 1. Transitions state machine to 'cancelled'
// 2. Appends 'cancelled' event to event store
// 3. Invalidates all outstanding tokens for this request
// 4. Sends cancellation notification to all approvers
// 5. Records in D1 audit trail
```

---

## Testing

### Mock Approval Gate

For testing tools and workflows without actual approval infrastructure:

```ts
import { createMockApprovalGate } from '@workkit/approval/testing'

const mockGate = createMockApprovalGate({
  /** Auto-approve all requests (default: false) */
  autoApprove?: boolean,

  /** Auto-deny all requests */
  autoDeny?: boolean,

  /** Specific decisions per action pattern */
  decisions?: Record<string, 'approve' | 'deny'>,

  /** Simulate timeout for these action patterns */
  timeoutActions?: string[],

  /** Record all guard calls for assertions */
  recordCalls?: boolean,
})

// Usage in tests:
const gate = createMockApprovalGate({ autoApprove: true })

const result = await gate.guard(
  { name: 'deploy:production', requestedBy: 'user:alice', tags: ['production'] },
  { identity: 'user:alice' },
)

expect(result.ok).toBe(true)
expect(result.value.status).toBe('allowed')

// Inspect recorded calls:
expect(mockGate.calls).toHaveLength(1)
expect(mockGate.calls[0].action.name).toBe('deploy:production')
```

### Testing Policy Matching

```ts
import { createPolicyTester } from '@workkit/approval/testing'

const tester = createPolicyTester()

// Register policies (same API as the real gate)
tester.policy('high-cost', {
  match: { type: 'cost', above: 10000 },
  approvers: ['user:cfo'],
  requiredApprovals: 1,
})

tester.policy('production', {
  match: { type: 'tag', allOf: ['production'] },
  approvers: { group: 'platform-team' },
  requiredApprovals: 2,
})

// Test which policies match
const matches = tester.evaluate({
  name: 'deploy:production',
  requestedBy: 'user:alice',
  tags: ['production'],
  cost: { amount: 50000, currency: 'USD' },
})

expect(matches.matchedPolicies).toEqual(['high-cost', 'production'])
expect(matches.resolved.requiredApprovals).toBe(2) // Most restrictive
expect(matches.resolved.approvers).toContain('user:cfo')
```

### Testing Timeout and Escalation

```ts
import { createTestApprovalGate } from '@workkit/approval/testing'

const { gate, clock, notifications } = createTestApprovalGate({
  // Inject a fake clock for time manipulation
  useFakeClock: true,
})

gate.policy('deploy', {
  match: { type: 'tag', allOf: ['deploy'] },
  approvers: ['user:bob'],
  timeout: '1h',
  escalation: [['user:charlie']],
  escalationInterval: '15m',
  onTimeout: 'deny',
})

const result = await gate.guard(
  { name: 'deploy:staging', requestedBy: 'user:alice', tags: ['deploy'] },
  { identity: 'user:alice' },
)

expect(result.value.status).toBe('pending')
const requestId = result.value.requestId

// Advance time by 15 minutes — should trigger escalation
await clock.advance('15m')
expect(notifications.sent).toContainEqual(
  expect.objectContaining({ type: 'approval_escalated', recipients: ['user:charlie'] }),
)

// Advance time by 45 more minutes — should trigger timeout
await clock.advance('45m')
const status = await gate.auditTrail(requestId)
expect(status.value.at(-1)?.eventType).toBe('timed_out')
```

---

## Integration with @workkit/mcp

### How Middleware Suspends and Resumes Tool Execution

The `gate.require()` middleware leverages Cloudflare Workers' ability to suspend execution within a request handler. The flow:

```
MCP Tool Call ──► require() middleware
                      │
                      ├──► Evaluate policies
                      │
                      ├──► No match ──► next() ──► tool handler executes
                      │
                      ├──► Match ──► Create approval request (DO)
                      │              │
                      │              ├──► Enqueue notifications
                      │              │
                      │              ├──► async: true? ──► Return 202 immediately
                      │              │
                      │              └──► async: false? ──► Wait for decision...
                      │                                         │
                      │                        ┌────────────────┤
                      │                        ▼                ▼
                      │                   Decision arrives   waitTimeout
                      │                        │                │
                      │                   Approved?         Return 202
                      │                   ├── Yes ──► next() ──► tool handler
                      │                   └── No  ──► Return 403
                      │
                      └──► Error ──► Return 500 (fail-closed)
```

### MCP Progress Notifications via SSE

The MCP integration uses **MCP progress notifications** over SSE (Streamable HTTP transport) to push real-time approval status updates to clients. This aligns with the MCP spec's `notifications/progress` pattern — no raw WebSocket needed.

```ts
interface ApprovalProgressEvent {
  type: 'approval:status'
  requestId: string
  status: ApprovalState
  message: string
  /** Remaining time before timeout */
  remainingMs?: number
  /** Number of approvals so far */
  currentApprovals?: number
  requiredApprovals?: number
  /** Approver activity */
  lastActivity?: {
    by: string
    action: string
    at: number
  }
}

// In the MCP server integration:
function createMCPApprovalHandler(gate: ApprovalGate, session: MCPSession) {
  return {
    async onToolCall(tool: string, args: unknown, context: MCPContext) {
      const action: ActionDescriptor = {
        name: `mcp:${tool}`,
        requestedBy: context.userId,
        metadata: { tool, args },
        risk: context.toolRisk ?? 'low',
        tags: context.toolTags ?? [],
      }

      const result = await gate.guard(action, { identity: context.userId })
      if (!result.ok) throw result.error

      if (result.value.status === 'pending') {
        const requestId = result.value.requestId
        const progressToken = context.progressToken

        // Send MCP progress notification that approval is pending
        if (progressToken) {
          session.sendNotification('notifications/progress', {
            progressToken,
            progress: 0,
            total: 1,
            metadata: {
              type: 'approval:status',
              requestId,
              status: 'pending',
              message: `Waiting for approval from ${result.value.approvers.join(', ')}`,
              remainingMs: result.value.expiresAt - Date.now(),
            },
          })
        }

        // Subscribe to decision updates from the DO, sending progress via SSE
        const decision = await waitForDecisionWithProgress(requestId, session, progressToken)

        if (decision.status === 'denied') {
          if (progressToken) {
            session.sendNotification('notifications/progress', {
              progressToken,
              progress: 1,
              total: 1,
              metadata: {
                type: 'approval:status',
                requestId,
                status: 'denied',
                message: `Denied by ${decision.decidedBy}: ${decision.reason}`,
              },
            })
          }
          throw new ApprovalError('DENIED', decision.reason)
        }

        if (progressToken) {
          session.sendNotification('notifications/progress', {
            progressToken,
            progress: 1,
            total: 1,
            metadata: {
              type: 'approval:status',
              requestId,
              status: 'approved',
              message: `Approved by ${decision.decidedBy}`,
            },
          })
        }
      }

      // Proceed with tool execution
      return await executeTool(tool, args, context)
    },
  }
}
```

### Progress Updates While Waiting

While an approval is pending, the system sends periodic MCP progress notifications over SSE:

```ts
async function waitForDecisionWithProgress(
  requestId: string,
  session: MCPSession,
  progressToken: string | undefined,
  pollIntervalMs = 5000,
): Promise<DecisionResult> {
  while (true) {
    const status = await gate.getRequestStatus(requestId)

    if (isTerminalState(status.state)) {
      return status
    }

    // Send MCP progress notification via SSE channel
    if (progressToken) {
      session.sendNotification('notifications/progress', {
        progressToken,
        progress: status.currentApprovals,
        total: status.requiredApprovals,
        metadata: {
          type: 'approval:status',
          requestId,
          status: status.state,
          message: formatProgressMessage(status),
          remainingMs: status.expiresAt - Date.now(),
          lastActivity: status.lastDecision ? {
            by: status.lastDecision.by,
            action: status.lastDecision.action,
            at: status.lastDecision.at,
          } : undefined,
        },
      })
    }

    await sleep(pollIntervalMs)
  }
}
```

---

## Complete Usage Example

```ts
import { createApprovalGate } from '@workkit/approval'
import { createWebhookChannel, createSlackChannel } from '@workkit/approval/channels'
import { generateSigningKeyPair } from '@workkit/crypto'
import { d1 } from '@workkit/d1'
import { queue } from '@workkit/queue'
import { createLogger } from '@workkit/logger'
import { Hono } from 'hono'

// --- Setup ---

const app = new Hono()
const log = createLogger({ service: 'my-api' })

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // Initialize signing keys (typically loaded from KV, not generated per-request)
    const signingKeys = await loadOrCreateSigningKeys(env)

    const gate = createApprovalGate({
      storage: env.APPROVAL_REQUESTS, // DO namespace
      audit: env.DB,                   // D1 database
      notificationQueue: env.APPROVAL_NOTIFICATIONS,
      signingKeys,
      baseUrl: 'https://api.example.com',
      logger: log,
      defaultTimeout: '1h',
      channels: [
        createSlackChannel({
          token: env.SLACK_TOKEN,
          defaultChannel: '#approvals',
          interactive: true,
        }),
        createWebhookChannel({
          url: env.APPROVAL_WEBHOOK_URL,
          signingSecret: env.WEBHOOK_SECRET,
        }),
      ],
    })

    // --- Policies ---

    gate.policy('production-deploy', {
      match: {
        type: 'all',
        matchers: [
          { type: 'tag', allOf: ['production'] },
          { type: 'name', pattern: 'deploy:*' },
        ],
      },
      approvers: { group: 'platform-team' },
      requiredApprovals: 2,
      timeout: '2h',
      escalation: [
        { group: 'platform-leads' },
        { role: 'vp-engineering' },
      ],
      escalationInterval: '30m',
      onTimeout: 'deny',
      approvalTTL: '30m',
    })

    gate.policy('high-cost-operation', {
      match: { type: 'cost', above: 10000 },
      approvers: ['user:cfo', 'user:cto'],
      requiredApprovals: 1,
      timeout: '4h',
      onTimeout: 'escalate',
      priority: 10, // Higher priority than production-deploy
    })

    gate.policy('destructive-operation', {
      match: { type: 'tag', anyOf: ['destructive', 'irreversible'] },
      approvers: { role: 'admin' },
      requiredApprovals: 1,
      timeout: '1h',
      onTimeout: 'deny',
    })

    gate.policy('default-catch-all', {
      match: { type: 'risk', minLevel: 'medium' },
      approvers: { role: 'team-lead' },
      requiredApprovals: 1,
      timeout: '1h',
      onTimeout: 'deny',
      priority: 999,
    })

    // --- Routes ---

    // Mount the approval decision router
    app.route('/approvals', gate.createRouter())

    // Gate a specific route
    app.post('/api/deploy/:env', gate.require({
      extractAction: (c) => ({
        name: `deploy:${c.req.param('env')}`,
        requestedBy: c.get('userId'),
        tags: c.req.param('env') === 'production' ? ['production', 'deploy'] : ['deploy'],
        metadata: { environment: c.req.param('env') },
      }),
    }), async (c) => {
      // This only executes after approval
      return c.json({ message: `Deployed to ${c.req.param('env')}` })
    })

    // Standalone guard usage
    app.post('/api/transfer', async (c) => {
      const body = await c.req.json<{ amount: number; currency: string; to: string }>()

      const result = await gate.guard(
        {
          name: 'transfer:funds',
          requestedBy: c.get('userId'),
          cost: { amount: body.amount, currency: body.currency },
          tags: ['financial'],
          metadata: { recipient: body.to },
        },
        { identity: c.get('userId') },
      )

      if (!result.ok) {
        return c.json({ error: result.error.message }, 500)
      }

      if (result.value.status === 'pending') {
        return c.json({
          message: 'Transfer requires approval',
          requestId: result.value.requestId,
          approvers: result.value.approvers,
          expiresAt: new Date(result.value.expiresAt).toISOString(),
        }, 202)
      }

      if (result.value.status === 'denied') {
        return c.json({ error: `Denied: ${result.value.reason}` }, 403)
      }

      // Allowed — execute transfer
      await executeTransfer(body)
      return c.json({ message: 'Transfer complete' })
    })

    return app.fetch(request, env, ctx)
  },
}
```

---

## D1 Migration

```sql
-- 001_create_approval_tables.sql

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  policy_name TEXT NOT NULL,
  required_approvals INTEGER NOT NULL DEFAULT 1,
  current_approvals INTEGER NOT NULL DEFAULT 0,
  approvers TEXT NOT NULL,              -- JSON array
  metadata TEXT,                        -- JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS approval_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT,
  event_payload TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  chain_hash TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (request_id) REFERENCES approval_requests(id)
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_requester ON approval_requests(requested_by);
CREATE INDEX IF NOT EXISTS idx_requests_action ON approval_requests(action);
CREATE INDEX IF NOT EXISTS idx_requests_created ON approval_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_requests_expires ON approval_requests(expires_at);

CREATE INDEX IF NOT EXISTS idx_audit_request ON approval_audit(request_id);
CREATE INDEX IF NOT EXISTS idx_audit_type ON approval_audit(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON approval_audit(actor);
CREATE INDEX IF NOT EXISTS idx_audit_created ON approval_audit(created_at);
```

---

## Error Hierarchy

```ts
import { WorkkitError } from '@workkit/errors'

class ApprovalError extends WorkkitError {
  readonly code: ApprovalErrorCode
  readonly statusCode: number
  readonly retryable: boolean
  readonly defaultRetryStrategy = { type: 'none' as const }
}

type ApprovalErrorCode =
  | 'APPROVAL_REQUIRED'       // 202 — action needs approval
  | 'APPROVAL_DENIED'         // 403 — request was denied
  | 'APPROVAL_TIMED_OUT'      // 408 — request timed out
  | 'APPROVAL_CANCELLED'      // 410 — request was cancelled
  | 'TOKEN_EXPIRED'           // 410 — approval token expired
  | 'TOKEN_ALREADY_USED'      // 409 — token was already consumed
  | 'INVALID_TOKEN'           // 401 — token failed verification
  | 'SELF_APPROVAL'           // 403 — requester tried to approve own request
  | 'ALREADY_DECIDED'         // 409 — approver already submitted a decision
  | 'REQUEST_NOT_FOUND'       // 404 — request ID doesn't exist
  | 'REQUEST_NOT_PENDING'     // 409 — request is in a terminal state
  | 'TOO_MANY_PENDING'        // 429 — max pending approvals reached
  | 'POLICY_ERROR'            // 500 — policy evaluation failed
  | 'APPROVAL_LOOP_DETECTED'  // 508 — circular approval dependency
  | 'NOTIFICATION_FAILED'     // 502 — all notification channels failed
```

---

## Package Structure

```
packages/approval/
  src/
    index.ts                    # Public API: createApprovalGate
    gate.ts                     # ApprovalGate implementation
    policy.ts                   # Policy engine: evaluation, matching, merging
    matchers.ts                 # PolicyMatcher implementations
    token.ts                    # Token generation and verification
    middleware.ts               # Hono middleware (require)
    router.ts                   # Decision endpoint router
    audit.ts                    # D1 audit projection + hash chain
    notification.ts             # Notification dispatcher
    errors.ts                   # ApprovalError definitions
    types.ts                    # All TypeScript interfaces
    channels/
      index.ts                  # Channel adapter exports
      webhook.ts                # Webhook adapter
      email.ts                  # Cloudflare Email Workers adapter
      slack.ts                  # Slack adapter
      telegram.ts               # Telegram adapter
    do/
      approval-request.ts       # ApprovalRequest Durable Object
      approval-counter.ts       # Global counter DO (rate limiting)
    testing/
      index.ts                  # Test utilities exports
      mock-gate.ts              # createMockApprovalGate
      policy-tester.ts          # createPolicyTester
      test-gate.ts              # createTestApprovalGate (with fake clock)
  package.json
  tsconfig.json
```

---

## Open Questions

1. **Batch approvals** — Should `gate.guardBatch(actions[])` be a first-class API, or should callers loop over `gate.guard()` individually? Batch would allow a single approval for N actions.

2. **Conditional approval** — Some workflows need "approved with conditions" (e.g., "approved, but only deploy to staging first"). Should the `approve` action accept structured conditions?

3. **Delegation** — Can an approver delegate their approval authority to someone else temporarily? This is common in enterprises during vacations.

4. **Policy versioning** — When a dynamic policy changes while requests are pending, should in-flight requests use the old policy or the new one?

5. **Cross-gate coordination** — If multiple services each have their own approval gate, should there be a way to create a single approval that spans gates?
