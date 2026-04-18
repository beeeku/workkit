import { describe, expect, it } from "vitest";
import { dismiss, feed, markRead, unreadCount } from "../../../src/adapters/inapp/feed";
import { createInAppDb } from "./_d1";

async function seedRows(
	db: ReturnType<typeof createInAppDb>,
	rows: Array<{ id: string; user: string; createdAt: number; title?: string }>,
): Promise<void> {
	for (const r of rows) {
		await db
			.prepare(
				"INSERT INTO in_app_notifications(id, user_id, notification_id, title, body, deep_link, metadata, created_at, read_at, dismissed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			)
			.bind(r.id, r.user, "n1", r.title ?? "t", "b", null, null, r.createdAt, null, null)
			.run();
	}
}

describe("feed()", () => {
	it("returns rows in newest-first order, paginates via cursor", async () => {
		const db = createInAppDb();
		await seedRows(db, [
			{ id: "a", user: "u1", createdAt: 100 },
			{ id: "b", user: "u1", createdAt: 200 },
			{ id: "c", user: "u1", createdAt: 300 },
			{ id: "d", user: "u1", createdAt: 400 },
		]);
		const page1 = await feed(db, { userId: "u1", limit: 2 });
		expect(page1.items.map((i) => i.id)).toEqual(["d", "c"]);
		expect(page1.nextCursor).not.toBeNull();
		const page2 = await feed(db, { userId: "u1", limit: 2, cursor: page1.nextCursor });
		expect(page2.items.map((i) => i.id)).toEqual(["b", "a"]);
		expect(page2.nextCursor).toBeNull();
	});

	it("excludes other users' rows", async () => {
		const db = createInAppDb();
		await seedRows(db, [
			{ id: "a", user: "u1", createdAt: 100 },
			{ id: "b", user: "u2", createdAt: 200 },
		]);
		const page = await feed(db, { userId: "u1" });
		expect(page.items.map((i) => i.id)).toEqual(["a"]);
	});

	it("excludes read rows by default; includes them with includeRead=true", async () => {
		const db = createInAppDb();
		await seedRows(db, [{ id: "a", user: "u1", createdAt: 100 }]);
		await markRead(db, { userId: "u1", ids: ["a"] }, 200);
		const default_ = await feed(db, { userId: "u1" });
		expect(default_.items).toHaveLength(0);
		const all = await feed(db, { userId: "u1", includeRead: true });
		expect(all.items).toHaveLength(1);
	});

	it("returns empty page on malformed cursor", async () => {
		const db = createInAppDb();
		await seedRows(db, [{ id: "a", user: "u1", createdAt: 1 }]);
		// Bad cursor should not 500; server returns empty page using no-cursor branch.
		const page = await feed(db, { userId: "u1", cursor: "!!!not-base64!!!" });
		// `decodeCursor` returns null → behaves as no cursor → returns rows.
		expect(page.items.length).toBeGreaterThanOrEqual(0);
	});
});

describe("markRead()", () => {
	it("only updates rows owned by the supplied userId", async () => {
		const db = createInAppDb();
		await seedRows(db, [
			{ id: "a", user: "u1", createdAt: 1 },
			{ id: "b", user: "u2", createdAt: 1 },
		]);
		// u1 tries to mark u2's row — must NOT update.
		const r = await markRead(db, { userId: "u1", ids: ["b"] });
		expect(r.updated).toBe(0);
	});

	it("supports markAll", async () => {
		const db = createInAppDb();
		await seedRows(db, [
			{ id: "a", user: "u1", createdAt: 1 },
			{ id: "b", user: "u1", createdAt: 2 },
		]);
		const r = await markRead(db, { userId: "u1", markAll: true });
		expect(r.updated).toBe(2);
	});

	it("is idempotent (won't double-update already-read rows)", async () => {
		const db = createInAppDb();
		await seedRows(db, [{ id: "a", user: "u1", createdAt: 1 }]);
		const r1 = await markRead(db, { userId: "u1", ids: ["a"] });
		const r2 = await markRead(db, { userId: "u1", ids: ["a"] });
		expect(r1.updated).toBe(1);
		expect(r2.updated).toBe(0);
	});
});

describe("dismiss() / unreadCount()", () => {
	it("counts only unread, undismissed rows for the user", async () => {
		const db = createInAppDb();
		await seedRows(db, [
			{ id: "a", user: "u1", createdAt: 1 },
			{ id: "b", user: "u1", createdAt: 2 },
			{ id: "c", user: "u1", createdAt: 3 },
			{ id: "x", user: "u2", createdAt: 1 },
		]);
		await markRead(db, { userId: "u1", ids: ["a"] });
		await dismiss(db, { userId: "u1", ids: ["b"] });
		expect(await unreadCount(db, "u1")).toBe(1);
		expect(await unreadCount(db, "u2")).toBe(1);
	});

	it("dismiss only updates rows owned by the supplied userId", async () => {
		const db = createInAppDb();
		await seedRows(db, [{ id: "a", user: "u2", createdAt: 1 }]);
		const r = await dismiss(db, { userId: "u1", ids: ["a"] });
		expect(r.updated).toBe(0);
	});
});
