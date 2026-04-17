/** Error codes specific to the chat transport layer */
export type ChatErrorCode =
	| "INVALID_MESSAGE"
	| "SESSION_NOT_FOUND"
	| "MESSAGE_TOO_LARGE"
	| "RATE_LIMITED";

/** Structured error for chat transport failures */
export class ChatError extends Error {
	readonly name = "ChatError";

	constructor(
		public readonly code: ChatErrorCode,
		message: string,
	) {
		super(message);
		Object.setPrototypeOf(this, new.target.prototype);
	}
}
