// Base
export { WorkkitError } from "./base";

// Types
export type {
	WorkkitErrorCode,
	RetryStrategy,
	SerializedError,
	WorkkitErrorOptions,
} from "./types";

// Error classes
export { BindingError, BindingNotFoundError } from "./categories/binding";
export { NotFoundError, ConflictError, ValidationError } from "./categories/data";
export type { ValidationIssue } from "./categories/data";
export { TimeoutError, RateLimitError, ServiceUnavailableError } from "./categories/network";
export { UnauthorizedError, ForbiddenError } from "./categories/auth";
export { InternalError, ConfigError } from "./categories/internal";

// Retry utilities
export { RetryStrategies, getRetryDelay, isRetryable, getRetryStrategy } from "./retry";

// HTTP helpers
export { errorToResponse, fromHttpStatus, isWorkkitError, isErrorCode } from "./http";

// Serialization
export { serializeError, wrapError } from "./serialize";
