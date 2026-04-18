import { describe, expect, it, vi } from "vitest";
import { inAppAdapter } from "../../../src/adapters/inapp/adapter";
import { forgetInAppUser } from "../../../src/adapters/inapp/forget";
import { SseRegistry } from "../../../src/adapters/inapp/sse";
import type { AdapterSendArgs, ChannelTemplate } from "../../../src/types";
import { createInAppDb } from "./_d1";

interface InAppPayload {
	[key: string]: unknown;
}

function args(template: ChannelTemplate<InAppPayload>): AdapterSendArgs<InAppPayload> {
	return {
		userId: "u1",
		notificationId: "pre-market-brief",
		channel: "inApp",
		address: "in-app",
		template,
		payload: { instrument: "NIFTY", summary: "..." },
		deliveryId: "d1",
		mode: "live",
	};
}

describe("inAppAdapter()", () => {
	it("inserts a row and returns 'delivered' with the row id as providerId", async () => {
		const db = createInAppDb();
		const adapter = inAppAdapter({ db });
		const result = await adapter.send(
			args({
				title: () => "NIFTY — Pre-Market Brief",
				body: () => "Short summary",
				deepLink: () => "https://app.example.com/briefs/r1",
			}),
		);
		expect(result.status).toBe("delivered");
		expect(result.providerId).toBeDefined();
		const row = await db
			.prepare("SELECT title, body, deep_link FROM in_app_notifications WHERE id = ?")
			.bind(result.providerId)
			.first<{ title: string; body: string; deep_link: string }>();
		expect(row?.title).toBe("NIFTY — Pre-Market Brief");
		expect(row?.deep_link).toBe("https://app.example.com/briefs/r1");
	});

	it("rejects bodies over the cap", async () => {
		const db = createInAppDb();
		const adapter = inAppAdapter({ db, maxBodyChars: 10 });
		const result = await adapter.send(args({ body: () => "way too long body here" }));
		expect(result.status).toBe("failed");
		expect(result.error).toContain("body exceeds cap");
	});

	it("rejects unsafe deep links via safeLink()", async () => {
		const db = createInAppDb();
		const adapter = inAppAdapter({ db });
		const result = await adapter.send(
			args({ body: () => "x", deepLink: () => "javascript:alert(1)" }),
		);
		expect(result.status).toBe("failed");
		expect(result.error).toContain("javascript");
	});

	it("pushes a JSON event to the SSE registry on successful send", async () => {
		const db = createInAppDb();
		const registry = new SseRegistry();
		const push = vi.fn();
		registry.add({ userId: "u1", push, close: () => undefined });
		const adapter = inAppAdapter({ db, registry });
		await adapter.send(args({ title: () => "T", body: () => "B" }));
		expect(push).toHaveBeenCalledTimes(1);
		const payload = JSON.parse(push.mock.calls[0]![0] as string);
		expect(payload).toMatchObject({ title: "T", body: "B", notificationId: "pre-market-brief" });
	});

	it("does NOT push to other users", async () => {
		const db = createInAppDb();
		const registry = new SseRegistry();
		const u2Push = vi.fn();
		registry.add({ userId: "u2", push: u2Push, close: () => undefined });
		const adapter = inAppAdapter({ db, registry });
		await adapter.send(args({ title: () => "T", body: () => "B" }));
		expect(u2Push).not.toHaveBeenCalled();
	});
});

describe("forgetInAppUser()", () => {
	it("deletes only the supplied user's rows and disconnects their SSE subs", async () => {
		const db = createInAppDb();
		const registry = new SseRegistry();
		const u1Close = vi.fn();
		const u2Close = vi.fn();
		registry.add({ userId: "u1", push: () => undefined, close: u1Close });
		registry.add({ userId: "u2", push: () => undefined, close: u2Close });
		await db
			.prepare(
				"INSERT INTO in_app_notifications(id, user_id, notification_id, title, body, deep_link, metadata, created_at, read_at, dismissed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
			)
			.bind("a", "u1", "n1", "t", "b", null, null, 1, null, null)
			.run();
		await db
			.prepare(
				"INSERT INTO in_app_notifications(id, user_id, notification_id, title, body, deep_link, metadata, created_at, read_at, dismissed_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
			)
			.bind("b", "u2", "n1", "t", "b", null, null, 1, null, null)
			.run();
		const r = await forgetInAppUser(db, "u1", registry);
		expect(r.rowsDeleted).toBe(1);
		expect(u1Close).toHaveBeenCalled();
		expect(u2Close).not.toHaveBeenCalled();
		const survivors = await db.prepare("SELECT id FROM in_app_notifications").all<{ id: string }>();
		expect(survivors.results).toEqual([{ id: "b" }]);
	});
});
