/**
 * All type definitions for @workkit/mail.
 * Follows workkit convention: options → results → handlers → internal.
 */

// --- Address types ---
// Named Mail* to avoid collisions with CF global EmailAddress/EmailAttachment

/** A structured email address with optional display name */
export interface MailAddress {
	readonly email: string;
	readonly name?: string;
}

/** An email attachment */
export interface MailAttachment {
	readonly filename: string;
	readonly content: string | ArrayBuffer | Uint8Array;
	readonly contentType: string;
	/** If true, embedded as inline image (requires contentId) */
	readonly inline?: boolean;
	/** Content-ID for inline attachments (used in HTML as cid:xxx) */
	readonly contentId?: string;
}

// --- Send types ---

/** Options for the mail() factory */
export interface MailOptions {
	/** Default sender address for all emails */
	readonly defaultFrom?: string | MailAddress;
}

/** A single outbound email message */
export interface MailMessage {
	readonly to: string | string[];
	readonly subject: string;
	readonly from?: string | MailAddress;
	readonly cc?: string | string[];
	readonly bcc?: string | string[];
	readonly replyTo?: string | MailAddress;
	readonly text?: string;
	readonly html?: string;
	readonly attachments?: readonly MailAttachment[];
	/** Custom headers (only X-* headers are reliable on CF) */
	readonly headers?: Readonly<Record<string, string>>;
}

/** Result of a send operation */
export interface SendResult {
	readonly messageId: string;
}

/** The typed mail client returned by mail() */
export interface TypedMailClient {
	/** Send a single email */
	send(message: MailMessage): Promise<SendResult>;
	/** Access the underlying SendEmail binding */
	readonly raw: SendEmail;
}

// --- Receive types ---

/** A parsed inbound email with convenience methods */
export interface InboundEmail {
	readonly from: string;
	readonly to: string;
	readonly subject: string;
	readonly text?: string;
	readonly html?: string;
	readonly headers: Headers;
	readonly rawSize: number;
	readonly messageId?: string;
	readonly inReplyTo?: string;
	readonly references?: string;
	readonly date?: string;
	readonly attachments: readonly ParsedAttachment[];
	/** Forward to a verified address */
	forward(rcptTo: string, headers?: Headers): Promise<void>;
	/** Reply with a new message */
	reply(message: ReplyMessage): Promise<void>;
	/** Reject with an SMTP error reason */
	setReject(reason: string): void;
}

/** A parsed attachment from an inbound email */
export interface ParsedAttachment {
	readonly filename?: string;
	readonly contentType: string;
	readonly content: ArrayBuffer | string;
	readonly contentId?: string;
	readonly disposition?: "attachment" | "inline";
}

/** Options for replying to an email */
export interface ReplyMessage {
	readonly from: string | MailAddress;
	readonly subject?: string;
	readonly text?: string;
	readonly html?: string;
}

/** Handler function for createEmailHandler */
export type EmailHandlerFn<Env = unknown> = (
	email: InboundEmail,
	env: Env,
	ctx: ExecutionContext,
) => void | Promise<void>;

/** Options for createEmailHandler */
export interface EmailHandlerOptions<Env = unknown> {
	readonly handler: EmailHandlerFn<Env>;
	/** Called when handler throws */
	readonly onError?: (error: unknown, email: InboundEmail) => void | Promise<void>;
}

// --- Router types ---

/** A route matcher — returns true if this route should handle the email */
export type EmailRouteMatcher = (email: InboundEmail) => boolean;

/** A single route definition */
export interface EmailRoute<Env = unknown> {
	readonly match: EmailRouteMatcher;
	readonly handler: EmailHandlerFn<Env>;
}

/** The email router returned by createEmailRouter() */
export interface EmailRouter<Env = unknown> {
	/** Add a route — emails matching the predicate go to this handler */
	match(predicate: EmailRouteMatcher, handler: EmailHandlerFn<Env>): EmailRouter<Env>;
	/** Set a default handler for unmatched emails */
	default(handler: EmailHandlerFn<Env>): EmailRouter<Env>;
	/** The CF email() export handler — wire this to your worker */
	handle: (message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) => Promise<void>;
}

// --- Compose types ---

/** Options for composing a MIME message */
export interface ComposeOptions {
	readonly from: string | MailAddress;
	readonly to: string | string[];
	readonly subject: string;
	readonly cc?: string | string[];
	readonly bcc?: string | string[];
	readonly replyTo?: string | MailAddress;
	readonly text?: string;
	readonly html?: string;
	readonly attachments?: readonly MailAttachment[];
	readonly headers?: Readonly<Record<string, string>>;
}

/** Result of MIME composition */
export interface ComposedMessage {
	readonly raw: string;
	readonly from: string;
	readonly to: string;
}
