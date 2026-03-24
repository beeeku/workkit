import type {
  ActionDescriptor,
  PolicyDefinition,
  PolicyMatcher,
  ResolvedPolicy,
  ApproverSpec,
  TimeoutCallback,
} from "./types";

// ─── Glob Matching ────────────────────────────────────────────

export function globMatch(pattern: string, value: string): boolean {
  // Normalize consecutive wildcards to prevent ReDoS
  const normalized = pattern.replace(/\*{2,}/g, "*");
  if ((normalized.match(/\*/g) || []).length > 5) {
    throw new Error("Glob pattern too complex (max 5 wildcards)");
  }
  const regexStr = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*?");
  return new RegExp(`^${regexStr}$`).test(value);
}

// ─── Risk Level Ordering ──────────────────────────────────────

const RISK_ORDER: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

// ─── Policy Matching ──────────────────────────────────────────

export function matchesPolicy(action: ActionDescriptor, matcher: PolicyMatcher): boolean {
  switch (matcher.type) {
    case "tag": {
      const tags = action.tags ?? [];
      if (matcher.allOf && !matcher.allOf.every((t) => tags.includes(t))) return false;
      if (matcher.anyOf && !matcher.anyOf.some((t) => tags.includes(t))) return false;
      if (matcher.noneOf && matcher.noneOf.some((t) => tags.includes(t))) return false;
      return true;
    }

    case "cost": {
      if (!action.cost) return false;
      if (matcher.currency && action.cost.currency !== matcher.currency) return false;
      return action.cost.amount >= matcher.greaterThanOrEqual;
    }

    case "risk": {
      if (!action.risk) return false;
      return RISK_ORDER[action.risk] >= RISK_ORDER[matcher.minLevel];
    }

    case "name": {
      return globMatch(matcher.pattern, action.name);
    }

    case "custom": {
      return matcher.fn(action);
    }

    case "all": {
      return matcher.matchers.every((m) => matchesPolicy(action, m));
    }

    case "any": {
      return matcher.matchers.some((m) => matchesPolicy(action, m));
    }
  }
}

// ─── Duration Parsing ─────────────────────────────────────────

export function parseDuration(str: string): number {
  const match = str.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/);
  if (!match) throw new Error(`Invalid duration: ${str}`);
  const value = parseFloat(match[1]);
  switch (match[2]) {
    case "ms": return value;
    case "s":  return value * 1_000;
    case "m":  return value * 60_000;
    case "h":  return value * 3_600_000;
    case "d":  return value * 86_400_000;
    default:   throw new Error(`Unknown unit: ${match[2]}`);
  }
}

const DEFAULT_TIMEOUT_MS = 3_600_000; // 1h
const DEFAULT_ESCALATION_INTERVAL_MS = 3_600_000; // 1h

// ─── Approver Resolution (literal arrays only) ─────────────────

function literalApprovers(spec: ApproverSpec): string[] {
  if (Array.isArray(spec)) return spec;
  return []; // group/role/resolve specs need runtime context — excluded from pure merge
}

// ─── Policy Merge ─────────────────────────────────────────────

interface NamedPolicy {
  name: string;
  def: PolicyDefinition;
}

function mergeMatchingPolicies(matches: NamedPolicy[]): ResolvedPolicy {
  // First match (by priority) provides the "winner" name
  const first = matches[0];

  const requiredApprovals = Math.max(
    ...matches.map((m) => m.def.requiredApprovals ?? 1),
  );

  const timeoutMs = Math.min(
    ...matches.map((m) =>
      m.def.timeout ? parseDuration(m.def.timeout) : DEFAULT_TIMEOUT_MS,
    ),
  );

  const approversSet = new Set<string>();
  for (const { def } of matches) {
    for (const a of literalApprovers(def.approvers)) {
      approversSet.add(a);
    }
  }

  const segregateRequester = matches.some(
    (m) => m.def.segregateRequester !== false,
  );

  // onTimeout: first match's value (highest priority)
  let onTimeout: ResolvedPolicy["onTimeout"] = "deny";
  for (const { def } of matches) {
    if (def.onTimeout !== undefined) {
      onTimeout = def.onTimeout as ResolvedPolicy["onTimeout"];
      break;
    }
  }

  // channels: union
  const channelsSet = new Set<string>();
  for (const { def } of matches) {
    for (const c of def.channels ?? []) channelsSet.add(c);
  }

  // escalation: first match
  const escalationSpec = first.def.escalation ?? [];
  const escalation: string[][] = escalationSpec.map((spec) =>
    literalApprovers(spec),
  );

  const escalationIntervalMs = first.def.escalationInterval
    ? parseDuration(first.def.escalationInterval)
    : DEFAULT_ESCALATION_INTERVAL_MS;

  return {
    name: first.name,
    priority: first.def.priority ?? 100,
    requiredApprovals,
    timeout: timeoutMs,
    approvers: Array.from(approversSet),
    segregateRequester,
    escalation,
    escalationInterval: escalationIntervalMs,
    onTimeout,
    channels: Array.from(channelsSet),
  };
}

// ─── Policy Evaluation ────────────────────────────────────────

export function evaluatePolicies(
  action: ActionDescriptor,
  policies: Map<string, PolicyDefinition>,
  dynamicPolicies: PolicyDefinition[],
): ResolvedPolicy | null {
  const matches: NamedPolicy[] = [];

  for (const [name, def] of policies) {
    if (matchesPolicy(action, def.match)) {
      matches.push({ name, def });
    }
  }

  for (let i = 0; i < dynamicPolicies.length; i++) {
    const def = dynamicPolicies[i];
    if (matchesPolicy(action, def.match)) {
      matches.push({ name: `dynamic-${i}`, def });
    }
  }

  if (matches.length === 0) return null;

  // Sort by priority ascending (lowest number = highest priority)
  matches.sort((a, b) => (a.def.priority ?? 100) - (b.def.priority ?? 100));

  return mergeMatchingPolicies(matches);
}
