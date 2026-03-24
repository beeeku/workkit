/**
 * In-memory mock implementations of CF Email types for testing.
 * Follows the mock-queue.ts pattern from @workkit/queue.
 */

export interface MockSendEmail {
	_sent: { from: string; to: string; raw: string }[];
	send(message: { from: string; to: string; raw: ReadableStream | string }): Promise<void>;
}

export function createMockSendEmail(): MockSendEmail {
	const mock: MockSendEmail = {
		_sent: [],
		async send(message) {
			const raw =
				typeof message.raw === "string"
					? message.raw
					: await new Response(message.raw).text();
			mock._sent.push({ from: message.from, to: message.to, raw });
		},
	};
	return mock;
}

export interface MockForwardableEmail {
	readonly from: string;
	readonly to: string;
	readonly headers: Headers;
	readonly raw: ReadableStream<Uint8Array>;
	readonly rawSize: number;
	_rejected: boolean;
	_rejectReason?: string;
	_forwarded: boolean;
	_forwardedTo?: string;
	_replied: boolean;
	setReject(reason: string): void;
	forward(rcptTo: string, headers?: Headers): Promise<void>;
	reply(message: { from: string; to: string; raw: ReadableStream | string }): Promise<void>;
}

export interface MockEmailOptions {
	from?: string;
	to?: string;
	subject?: string;
	text?: string;
	html?: string;
	headers?: Record<string, string>;
}

/**
 * Create a mock ForwardableEmailMessage for testing inbound handlers.
 * Constructs a minimal valid MIME message from the provided options.
 */
export function createMockForwardableEmail(
	options: MockEmailOptions = {},
): MockForwardableEmail {
	const from = options.from ?? "sender@example.com";
	const to = options.to ?? "recipient@example.com";
	const subject = options.subject ?? "Test Subject";
	const text = options.text ?? "Test body";

	const rawMime = [
		`From: ${from}`,
		`To: ${to}`,
		`Subject: ${subject}`,
		`Date: ${new Date().toUTCString()}`,
		`Message-ID: <mock-${Date.now()}@example.com>`,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=utf-8",
		"",
		text,
	].join("\r\n");

	const rawBytes = new TextEncoder().encode(rawMime);
	const headers = new Headers();
	headers.set("from", from);
	headers.set("to", to);
	headers.set("subject", subject);

	for (const [key, value] of Object.entries(options.headers ?? {})) {
		headers.set(key, value);
	}

	const mock: MockForwardableEmail = {
		from,
		to,
		headers,
		raw: new ReadableStream({
			start(controller) {
				controller.enqueue(rawBytes);
				controller.close();
			},
		}),
		rawSize: rawBytes.byteLength,
		_rejected: false,
		_rejectReason: undefined,
		_forwarded: false,
		_forwardedTo: undefined,
		_replied: false,
		setReject(reason) {
			mock._rejected = true;
			mock._rejectReason = reason;
		},
		async forward(rcptTo) {
			mock._forwarded = true;
			mock._forwardedTo = rcptTo;
		},
		async reply() {
			mock._replied = true;
		},
	};
	return mock;
}
