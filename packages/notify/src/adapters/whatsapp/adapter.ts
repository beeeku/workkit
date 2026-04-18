import type {
	Adapter,
	AdapterSendArgs,
	AdapterSendResult,
	NotifyD1,
	WebhookEvent,
} from "../../types";
import { MarketingPausedError, OptInRequiredError, WhatsAppPhoneFormatError } from "./errors";
import { type StopMatchOptions, isStopKeyword } from "./keywords";
import { MarketingPauseRegistry } from "./marketing-pause";
import { cacheKey, getCached, putCached } from "./media-cache";
import { isOptedIn, revokeOptIn } from "./opt-in";
import { type PhoneCipher, assertE164 } from "./phone";
import type { WaProvider, WhatsAppCategory } from "./provider";
import { recordInbound, withinSessionWindow } from "./session-window";

export interface WhatsAppPayload {
	[key: string]: unknown;
}

interface R2BucketLike {
	get(key: string): Promise<{
		body: ReadableStream | null;
		arrayBuffer(): Promise<ArrayBuffer>;
		etag?: string;
		httpMetadata?: { contentType?: string };
	} | null>;
}

/**
 * Pluggable check for "is the recipient on the DND registry?". Adapter
 * only invokes this for `category: "marketing"` templates. Returning true
 * causes the send to be marked `skipped`.
 */
export type DndChecker = (phoneE164: string) => Promise<boolean>;

/**
 * Caller-provided opt-out hook. Invoked when an inbound message matches a
 * STOP/UNSUBSCRIBE keyword (after webhook signature verification).
 * `notificationId: null` because STOPs are global by intent.
 */
export type WaOptOutHook = (
	userId: string,
	channel: "whatsapp",
	notificationId: null,
	reason: "inbound-stop",
) => Promise<void>;

export interface WhatsAppTemplateRef {
	name: string;
	language: string;
	variables?: (payload: WhatsAppPayload) => ReadonlyArray<string>;
	category: WhatsAppCategory;
	media?: (payload: WhatsAppPayload) => { r2Key: string; mimeType?: string } | undefined;
}

export interface WhatsAppAdapterOptions {
	provider: WaProvider;
	db: NotifyD1;
	bucket?: R2BucketLike;
	cipher?: PhoneCipher;
	pauseRegistry?: MarketingPauseRegistry;
	dndCheck?: DndChecker;
	optOutHook?: WaOptOutHook;
	stopKeywords?: StopMatchOptions;
	/** Optional resolver: webhook payload `from` (E.164) → your internal userId. */
	userIdFromPhone?: (phoneE164: string) => Promise<string | null>;
	/** Force template send even when inside the 24h session window (rare; defaults false). */
	forceTemplate?: boolean;
}

const PROVIDER_NAMES = new Set<WaProvider["name"]>(["meta", "twilio", "gupshup"]);

export function whatsappAdapter(options: WhatsAppAdapterOptions): Adapter<WhatsAppPayload> {
	if (!PROVIDER_NAMES.has(options.provider.name)) {
		throw new Error(`unknown WhatsApp provider: ${(options.provider as WaProvider).name}`);
	}
	const pause = options.pauseRegistry ?? new MarketingPauseRegistry();

	return {
		async send(args: AdapterSendArgs<WhatsAppPayload>): Promise<AdapterSendResult> {
			let toE164: string;
			try {
				toE164 = assertE164(args.address);
			} catch (err) {
				if (err instanceof WhatsAppPhoneFormatError) {
					return { status: "failed", error: err.message };
				}
				throw err;
			}

			// Opt-in proof: refuse to call the provider without one.
			const ok = await isOptedIn({ db: options.db, cipher: options.cipher }, args.userId);
			if (!ok) {
				return { status: "failed", error: new OptInRequiredError(args.userId).message };
			}

			const tpl = args.template as { template?: WhatsAppTemplateRef };
			const template = tpl.template;
			const isMarketing = template?.category === "marketing";

			// Marketing-pause check.
			if (isMarketing && pause.isPaused()) {
				return {
					status: "failed",
					error: new MarketingPausedError(args.notificationId).message,
				};
			}

			// DND check (marketing only).
			if (isMarketing && options.dndCheck) {
				const blocked = await options.dndCheck(toE164);
				if (blocked) {
					return { status: "failed", error: "dnd-india: recipient on do-not-disturb registry" };
				}
			}

			// 24h session-window routing: outside window forces template send.
			const inWindow = await withinSessionWindow({ db: options.db }, args.userId);
			const useTemplate = options.forceTemplate || !inWindow || template !== undefined;

			if (useTemplate && !template) {
				return {
					status: "failed",
					error: "WhatsApp send outside the 24h session window requires an approved template",
				};
			}

			// Optional media: upload (or reuse cached id) before send.
			let media: { mediaId: string; mimeType?: string } | undefined;
			if (template?.media) {
				const ref = template.media(args.payload);
				if (ref) {
					if (!options.bucket) {
						return { status: "failed", error: "WhatsApp media requires bucket option" };
					}
					const obj = await options.bucket.get(ref.r2Key);
					if (!obj) {
						return { status: "failed", error: `R2 object missing: ${ref.r2Key}` };
					}
					const etag = obj.etag ?? "noetag";
					const key = cacheKey(options.provider.name, ref.r2Key, etag);
					const cached = await getCached({ db: options.db }, key);
					if (cached) {
						media = { mediaId: cached.mediaId, mimeType: cached.mimeType };
					} else {
						const bytes = new Uint8Array(await obj.arrayBuffer());
						const mimeType =
							ref.mimeType ?? obj.httpMetadata?.contentType ?? "application/octet-stream";
						const uploaded = await options.provider.uploadMedia({
							bytes,
							mimeType,
							filename: ref.r2Key.split("/").pop(),
						});
						await putCached({ db: options.db }, key, {
							provider: options.provider.name,
							mediaId: uploaded.mediaId,
							mimeType,
							bytes: bytes.byteLength,
						});
						media = { mediaId: uploaded.mediaId, mimeType };
					}
				}
			}

			try {
				const result = await options.provider.send({
					toE164,
					template: template
						? {
								name: template.name,
								language: template.language,
								category: template.category,
								variables: template.variables?.(args.payload),
							}
						: undefined,
					media,
				});
				return { status: "sent", providerId: result.providerId };
			} catch (err) {
				return { status: "failed", error: err instanceof Error ? err.message : String(err) };
			}
		},

		async parseWebhook(req: Request): Promise<WebhookEvent[]> {
			const events = await options.provider.parseWebhook(req);
			const out: WebhookEvent[] = [];
			for (const ev of events) {
				if (ev.kind === "delivery") {
					out.push(ev.event);
					continue;
				}
				if (ev.kind === "inbound") {
					await handleInbound(ev.message.from, ev.message.text, ev.message.at, options);
					continue;
				}
				if (ev.kind === "quality") {
					if (ev.alert.level === "low" || ev.alert.level === "flagged") {
						await pause.pause(`meta-quality:${ev.alert.level}`);
					}
				}
			}
			return out;
		},

		async verifySignature(req: Request, secret: string): Promise<boolean> {
			try {
				return await options.provider.verifySignature(req, secret);
			} catch {
				return false;
			}
		},
	};
}

async function handleInbound(
	fromE164: string,
	text: string | undefined,
	at: number,
	options: WhatsAppAdapterOptions,
): Promise<void> {
	// Update session-window state first — this is what unblocks session-message
	// sends without forcing a template.
	const userId = (await options.userIdFromPhone?.(fromE164)) ?? fromE164;
	await recordInbound({ db: options.db }, { userId, at, text });

	if (text && isStopKeyword(text, options.stopKeywords)) {
		await revokeOptIn({ db: options.db, cipher: options.cipher }, userId, "inbound-stop");
		await options.optOutHook?.(userId, "whatsapp", null, "inbound-stop");
	}
}
