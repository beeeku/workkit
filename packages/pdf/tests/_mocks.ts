import type { BrowserPageLike, BrowserSessionLike } from "@workkit/browser";
import type { PdfCapablePage, PdfPageOptions, R2BucketLike } from "../src/types";

export interface MockPage extends PdfCapablePage {
	captured: {
		html?: string;
		pdfOptions?: PdfPageOptions;
		closed: number;
		setJsEnabled?: boolean;
	};
}

export function mockSession(returnBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46])): {
	session: BrowserSessionLike;
	page: MockPage;
} {
	const page: MockPage = {
		captured: { closed: 0 },
		setJavaScriptEnabled(enabled) {
			this.captured.setJsEnabled = enabled;
		},
		setDefaultTimeout() {},
		setDefaultNavigationTimeout() {},
		on() {
			return this;
		},
		async setContent(html) {
			this.captured.html = html;
		},
		async pdf(options) {
			this.captured.pdfOptions = options;
			return returnBytes;
		},
		async close() {
			this.captured.closed += 1;
		},
	};
	return {
		session: {
			async newPage() {
				return page as BrowserPageLike;
			},
			async close() {},
		},
		page,
	};
}

export interface MockBucket extends R2BucketLike {
	puts: { key: string; bytes: number; metadata?: Record<string, string>; contentType?: string }[];
	presignCalls: { key: string; expiresIn: number }[];
}

export function mockBucket(opts: { supportsPresign?: boolean } = {}): MockBucket {
	const supportsPresign = opts.supportsPresign !== false;
	const bucket: MockBucket = {
		puts: [],
		presignCalls: [],
		async put(key, body, options) {
			const buf = body instanceof Uint8Array ? body : new Uint8Array(0);
			bucket.puts.push({
				key,
				bytes: buf.byteLength,
				metadata: options?.customMetadata,
				contentType: options?.httpMetadata?.contentType,
			});
		},
	};
	if (supportsPresign) {
		bucket.createPresignedUrl = async (key, options) => {
			bucket.presignCalls.push({ key, expiresIn: options.expiresIn });
			return `https://signed.example.com/${key}?ttl=${options.expiresIn}`;
		};
	}
	return bucket;
}
