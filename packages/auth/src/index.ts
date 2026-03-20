// JWT
export { signJWT, verifyJWT, decodeJWT, parseDuration } from "./jwt";

// Auth handler
export { createAuthHandler } from "./handler";

// Session management
export { createSessionManager } from "./session";

// Header extraction
export { extractBearerToken, extractBasicAuth } from "./extract";

// Password hashing
export { hashPassword, verifyPassword } from "./password";

// Types
export type {
	JWTAlgorithm,
	JWTHeader,
	JWTStandardClaims,
	SignJWTOptions,
	VerifyJWTOptions,
	DecodedJWT,
	AuthHandlerConfig,
	AuthenticatedHandler,
	OptionalAuthHandler,
	AuthHandler,
	SessionConfig,
	Session,
	CreateSessionResult,
	SessionManager,
	BasicAuthCredentials,
	PasswordHash,
} from "./types";
