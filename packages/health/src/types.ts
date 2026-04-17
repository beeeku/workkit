export type ProbeStatus = "healthy" | "degraded" | "unhealthy";

export interface ProbeResult {
	name: string;
	status: ProbeStatus;
	latencyMs: number;
	message?: string;
	checkedAt: string; // ISO timestamp
}

export interface ProbeConfig {
	name: string;
	check: () => Promise<void>; // throws on failure
	critical?: boolean; // default true
	timeout?: number; // ms, default 5000
}

export interface HealthResult {
	status: ProbeStatus;
	version?: string;
	timestamp: string;
	checks: ProbeResult[];
}

export interface HealthCheckOptions {
	version?: string;
	cacheTtl?: number; // seconds, debounce re-checks
}

export interface HealthHandlerOptions extends HealthCheckOptions {
	path?: string; // default "/health"
}
