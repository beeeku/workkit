/**
 * In-memory marketing-pause flag, single-Worker-isolate scope.
 *
 * Quality-rating webhooks call `pause()` to halt `category: marketing` sends
 * pending operator review. Multi-isolate fan-out is a v2 concern (Durable
 * Object). For v1, Meta's quality metric is slow-moving — a 30s propagation
 * gap across isolates is acceptable.
 *
 * Audit hook receives every transition so callers can persist + alert.
 */

export interface MarketingPauseAuditEvent {
	at: number;
	state: "paused" | "resumed";
	reason: string;
}

export type MarketingPauseAuditHook = (event: MarketingPauseAuditEvent) => void | Promise<void>;

export class MarketingPauseRegistry {
	private paused = false;
	private reason: string | undefined;
	private auditHook: MarketingPauseAuditHook | undefined;

	constructor(options: { auditHook?: MarketingPauseAuditHook } = {}) {
		this.auditHook = options.auditHook;
	}

	isPaused(): boolean {
		return this.paused;
	}

	pauseReason(): string | undefined {
		return this.reason;
	}

	async pause(reason: string): Promise<void> {
		if (this.paused) return;
		this.paused = true;
		this.reason = reason;
		await this.auditHook?.({ at: Date.now(), state: "paused", reason });
	}

	async resume(reason: string): Promise<void> {
		if (!this.paused) return;
		this.paused = false;
		this.reason = undefined;
		await this.auditHook?.({ at: Date.now(), state: "resumed", reason });
	}
}
