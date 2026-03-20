import { WorkkitError } from "@workkit/errors";
import type { RetryStrategy, WorkkitErrorOptions } from "@workkit/errors";

/**
 * Base D1 error.
 */
export class D1Error extends WorkkitError {
	readonly code = "WORKKIT_D1_QUERY" as const;
	readonly statusCode = 500;
	readonly retryable = false;
	readonly defaultRetryStrategy: RetryStrategy = { kind: "none" };
}

/**
 * D1 query execution error.
 */
export class D1QueryError extends WorkkitError {
	readonly code = "WORKKIT_D1_QUERY" as const;
	readonly statusCode = 500;
	readonly retryable = false;
	readonly defaultRetryStrategy: RetryStrategy = { kind: "none" };

	readonly sql: string;
	readonly params?: unknown[];

	constructor(message: string, sql: string, params?: unknown[], options?: WorkkitErrorOptions) {
		super(`D1 query failed: ${message}`, {
			...options,
			context: { ...options?.context, sql, params },
		});
		this.sql = sql;
		this.params = params;
	}
}

/**
 * D1 constraint violation (UNIQUE, CHECK, FOREIGN KEY, NOT NULL).
 */
export class D1ConstraintError extends WorkkitError {
	readonly code = "WORKKIT_D1_CONSTRAINT" as const;
	readonly statusCode = 409;
	readonly retryable = true;
	readonly defaultRetryStrategy: RetryStrategy = {
		kind: "exponential",
		baseMs: 100,
		maxMs: 5000,
		maxAttempts: 3,
	};

	readonly constraintType: "UNIQUE" | "CHECK" | "FOREIGN_KEY" | "NOT_NULL" | "UNKNOWN";

	constructor(message: string, constraintType?: string, options?: WorkkitErrorOptions) {
		super(`D1 constraint violation: ${message}`, {
			...options,
			context: { ...options?.context, constraintType },
		});
		this.constraintType = parseConstraintType(constraintType);
	}
}

/**
 * D1 batch operation failure.
 */
export class D1BatchError extends WorkkitError {
	readonly code = "WORKKIT_D1_BATCH" as const;
	readonly statusCode = 500;
	readonly retryable = false;
	readonly defaultRetryStrategy: RetryStrategy = { kind: "none" };

	readonly failedIndex?: number;

	constructor(message: string, failedIndex?: number, options?: WorkkitErrorOptions) {
		super(`D1 batch failed: ${message}`, {
			...options,
			context: { ...options?.context, failedIndex },
		});
		this.failedIndex = failedIndex;
	}
}

/**
 * Migration error.
 */
export class D1MigrationError extends WorkkitError {
	readonly code = "WORKKIT_D1_MIGRATION" as const;
	readonly statusCode = 500;
	readonly retryable = false;
	readonly defaultRetryStrategy: RetryStrategy = { kind: "none" };

	readonly migrationName: string;

	constructor(migrationName: string, message: string, options?: WorkkitErrorOptions) {
		super(`Migration "${migrationName}" failed: ${message}`, {
			...options,
			context: { ...options?.context, migrationName },
		});
		this.migrationName = migrationName;
	}
}

function parseConstraintType(
	raw?: string,
): "UNIQUE" | "CHECK" | "FOREIGN_KEY" | "NOT_NULL" | "UNKNOWN" {
	if (!raw) return "UNKNOWN";
	const upper = raw.toUpperCase();
	if (upper.includes("UNIQUE")) return "UNIQUE";
	if (upper.includes("CHECK")) return "CHECK";
	if (upper.includes("FOREIGN")) return "FOREIGN_KEY";
	if (upper.includes("NOT NULL")) return "NOT_NULL";
	return "UNKNOWN";
}

/**
 * Classify a D1 error into the appropriate workkit error.
 */
export function classifyD1Error(error: unknown, sql?: string, params?: unknown[]): WorkkitError {
	const message = error instanceof Error ? error.message : String(error);

	// Constraint violations
	if (
		message.includes("UNIQUE constraint failed") ||
		message.includes("CHECK constraint failed") ||
		message.includes("FOREIGN KEY constraint failed") ||
		message.includes("NOT NULL constraint failed")
	) {
		return new D1ConstraintError(message, message);
	}

	// Table/column not found
	if (message.includes("no such table") || message.includes("no such column")) {
		return new D1QueryError(message, sql ?? "unknown", params);
	}

	// Syntax errors
	if (message.includes("near") && message.includes("syntax error")) {
		return new D1QueryError(message, sql ?? "unknown", params);
	}

	// Generic D1 error
	return new D1Error(message, { cause: error, context: { sql, params } });
}
