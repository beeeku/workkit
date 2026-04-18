import type { WebhookEvent } from "../../../types";
import { TemplateNotApprovedError, WhatsAppWebhookSignatureError } from "../errors";
import type {
	WaInboundMessage,
	WaProvider,
	WaProviderEvent,
	WaQualityAlert,
	WaSendArgs,
	WaSendResult,
	WaUploadArgs,
} from "../provider";

const DEFAULT_GRAPH_URL = "https://graph.facebook.com";
const DEFAULT_GRAPH_VERSION = "v20.0";

export interface MetaWaProviderOptions {
	accessToken: string; // Meta system user token
	phoneNumberId: string;
	apiUrl?: string;
	graphVersion?: string;
}

export function metaWaProvider(options: MetaWaProviderOptions): WaProvider {
	const apiUrl = options.apiUrl ?? DEFAULT_GRAPH_URL;
	const version = options.graphVersion ?? DEFAULT_GRAPH_VERSION;
	const sendUrl = `${apiUrl}/${version}/${options.phoneNumberId}/messages`;
	const mediaUrl = `${apiUrl}/${version}/${options.phoneNumberId}/media`;

	return {
		name: "meta" as const,
		async send(args: WaSendArgs): Promise<WaSendResult> {
			const body: Record<string, unknown> = {
				messaging_product: "whatsapp",
				to: args.toE164,
				recipient_type: "individual",
			};
			if (args.template) {
				body.type = "template";
				body.template = {
					name: args.template.name,
					language: { code: args.template.language },
					components:
						args.template.variables && args.template.variables.length > 0
							? [
									{
										type: "body",
										parameters: args.template.variables.map((v) => ({ type: "text", text: v })),
									},
								]
							: undefined,
				};
			} else if (args.media) {
				body.type = args.media.mimeType?.startsWith("image/")
					? "image"
					: args.media.mimeType?.startsWith("video/")
						? "video"
						: "document";
				body[body.type as string] = { id: args.media.mediaId };
			} else if (args.sessionText) {
				body.type = "text";
				body.text = { body: args.sessionText };
			} else {
				throw new TemplateNotApprovedError("WaSendArgs requires template, media, or sessionText");
			}

			const resp = await fetch(sendUrl, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${options.accessToken}`,
				},
				body: JSON.stringify(body),
			});
			const json = (await resp.json().catch(() => null)) as {
				messages?: { id: string }[];
				error?: { message?: string; code?: number; type?: string };
			} | null;
			if (!resp.ok) {
				const message = json?.error?.message ?? `Meta WA HTTP ${resp.status} ${resp.statusText}`;
				if (
					json?.error?.code === 132000 ||
					json?.error?.code === 132001 ||
					/template/i.test(message)
				) {
					throw new TemplateNotApprovedError(message);
				}
				throw new Error(message);
			}
			const id = json?.messages?.[0]?.id;
			if (!id) throw new Error("Meta WA response missing messages[0].id");
			return { providerId: id };
		},

		async uploadMedia(args: WaUploadArgs) {
			const form = new FormData();
			form.append("messaging_product", "whatsapp");
			form.append("type", args.mimeType);
			form.append("file", new Blob([args.bytes], { type: args.mimeType }), args.filename ?? "file");
			const resp = await fetch(mediaUrl, {
				method: "POST",
				headers: { authorization: `Bearer ${options.accessToken}` },
				body: form,
			});
			const json = (await resp.json().catch(() => null)) as {
				id?: string;
				error?: { message?: string };
			} | null;
			if (!resp.ok || !json?.id) {
				throw new Error(json?.error?.message ?? `Meta WA media upload HTTP ${resp.status}`);
			}
			return { mediaId: json.id, mimeType: args.mimeType };
		},

		async parseWebhook(req: Request): Promise<WaProviderEvent[]> {
			const raw = await req.clone().text();
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch {
				return [];
			}
			return mapMetaWebhookPayload(parsed);
		},

		async verifySignature(req: Request, secret: string): Promise<boolean> {
			const header = req.headers.get("x-hub-signature-256");
			if (!header || !header.startsWith("sha256=")) return false;
			const expectedHex = header.slice("sha256=".length).toLowerCase();
			const rawBody = await req.text();
			try {
				const key = await crypto.subtle.importKey(
					"raw",
					new TextEncoder().encode(secret),
					{ name: "HMAC", hash: "SHA-256" },
					false,
					["sign"],
				);
				const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
				const actualHex = bufferToHex(new Uint8Array(sig));
				return constantTimeEqualHex(expectedHex, actualHex);
			} catch {
				throw new WhatsAppWebhookSignatureError("HMAC computation failed");
			}
		},

		handleVerificationChallenge(req: Request, verifyToken: string): Response | null {
			if (req.method !== "GET") return null;
			const url = new URL(req.url);
			const mode = url.searchParams.get("hub.mode");
			const challenge = url.searchParams.get("hub.challenge");
			const token = url.searchParams.get("hub.verify_token");
			if (mode !== "subscribe") return null;
			if (token !== verifyToken) {
				return new Response("forbidden", { status: 403 });
			}
			return new Response(challenge ?? "", {
				status: 200,
				headers: { "content-type": "text/plain" },
			});
		},
	};
}

interface MetaWebhookPayload {
	entry?: Array<{
		changes?: Array<{
			field?: string;
			value?: {
				messages?: Array<{
					from?: string;
					id?: string;
					text?: { body?: string };
					timestamp?: string;
				}>;
				statuses?: Array<{
					id?: string;
					recipient_id?: string;
					status?: string;
					timestamp?: string;
				}>;
				messaging_product?: string;
			};
		}>;
	}>;
}

function mapMetaWebhookPayload(parsed: unknown): WaProviderEvent[] {
	const out: WaProviderEvent[] = [];
	const root = parsed as MetaWebhookPayload & {
		entry?: Array<{
			changes?: Array<{
				field?: string;
				value?: { event?: string; current_limit?: string; quality_score?: { score?: string } };
			}>;
		}>;
	};
	for (const entry of root.entry ?? []) {
		for (const change of entry.changes ?? []) {
			const v = change.value as
				| { messages?: unknown[]; statuses?: unknown[]; quality_score?: { score?: string } }
				| undefined;
			if (!v) continue;

			// Quality alert (account_update.phone_quality)
			if (change.field === "account_update" && v.quality_score) {
				const level = (v.quality_score.score ?? "").toLowerCase();
				if (level === "low" || level === "medium" || level === "high" || level === "flagged") {
					const alert: WaQualityAlert = { level, at: Date.now(), raw: change };
					out.push({ kind: "quality", alert });
				}
				continue;
			}

			// Inbound messages
			interface InboundMsgShape {
				from?: string;
				text?: { body?: string };
				timestamp?: string;
			}
			const messages = (v.messages as InboundMsgShape[] | undefined) ?? [];
			for (const msg of messages) {
				if (!msg?.from) continue;
				const inbound: WaInboundMessage = {
					from: msg.from,
					text: msg.text?.body,
					at: msg.timestamp ? Number(msg.timestamp) * 1000 : Date.now(),
					raw: msg,
				};
				out.push({ kind: "inbound", message: inbound });
			}

			// Delivery statuses
			interface StatusShape {
				id?: string;
				recipient_id?: string;
				status?: string;
				timestamp?: string;
			}
			const statuses = (v.statuses as StatusShape[] | undefined) ?? [];
			for (const status of statuses) {
				if (!status?.id) continue;
				const mapped = mapStatus(status.status);
				if (!mapped) continue;
				const event: WebhookEvent = {
					channel: "whatsapp",
					providerId: status.id,
					status: mapped,
					at: status.timestamp ? Number(status.timestamp) * 1000 : Date.now(),
					raw: status,
				};
				out.push({ kind: "delivery", event });
			}
		}
	}
	return out;
}

function mapStatus(s: string | undefined): WebhookEvent["status"] | undefined {
	switch (s) {
		case "delivered":
			return "delivered";
		case "read":
			return "read";
		case "failed":
			return "failed";
		case "sent":
			return "delivered"; // closest mapping; Meta's "sent" means provider-accepted
		default:
			return undefined;
	}
}

function bufferToHex(bytes: Uint8Array): string {
	let s = "";
	for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, "0");
	return s;
}

function constantTimeEqualHex(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}
