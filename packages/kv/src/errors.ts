import {
	BindingNotFoundError,
	ConfigError,
	InternalError,
	ServiceUnavailableError,
	TimeoutError,
	ValidationError,
} from "@workkit/errors";

export interface KVErrorContext {
	key?: string;
	prefix?: string;
	operation:
		| "get"
		| "put"
		| "delete"
		| "list"
		| "getWithMetadata"
		| "getMany"
		| "putMany"
		| "deleteMany";
	binding?: string;
}

export function assertKVBinding(binding: unknown): asserts binding is KVNamespace {
	if (!binding || typeof binding !== "object") {
		throw new BindingNotFoundError("KVNamespace");
	}
	const obj = binding as Record<string, unknown>;
	if (
		typeof obj.get !== "function" ||
		typeof obj.put !== "function" ||
		typeof obj.delete !== "function" ||
		typeof obj.list !== "function"
	) {
		throw new ConfigError(
			"Value does not appear to be a KVNamespace binding. " +
				"Ensure it is configured in wrangler.toml under [[kv_namespaces]].",
		);
	}
}

export function assertValidTtl(ttl: number | undefined): void {
	if (ttl !== undefined && ttl < 60) {
		throw new ValidationError(`KV expiration TTL must be at least 60 seconds, received ${ttl}`, [
			{
				path: ["ttl"],
				message: "Minimum TTL is 60 seconds",
				code: "WORKKIT_KV_TTL_TOO_LOW",
			},
		]);
	}
}

export function wrapKVError(error: unknown, context: KVErrorContext): never {
	const message = error instanceof Error ? error.message : String(error);

	const ctx = context as unknown as Record<string, unknown>;

	if (message.includes("timeout") || message.includes("timed out")) {
		throw new TimeoutError(`KV.${context.operation}`, undefined, {
			cause: error,
			context: ctx,
		});
	}

	if (message.includes("503") || message.includes("service") || message.includes("unavailable")) {
		throw new ServiceUnavailableError("KV", {
			cause: error,
			context: ctx,
		});
	}

	throw new InternalError(`KV.${context.operation} failed: ${message}`, {
		cause: error,
		context: ctx,
	});
}
