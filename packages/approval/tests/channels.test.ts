import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWebhookChannel } from "../src/channels/webhook";
import type { ChannelAdapter, NotificationPayload } from "../src/types";

const mockNotification: NotificationPayload = {
	type: "approval_requested",
	request: {
		id: "apr_123",
		action: "deploy:production",
		requestedBy: "alice",
		requestedAt: Date.now(),
		status: "pending",
		approvers: ["bob"],
		requiredApprovals: 1,
		currentApprovals: 0,
		expiresAt: Date.now() + 3600000,
		policyName: "prod",
	},
	recipients: ["bob"],
	decisionUrl: "https://example.com/approvals/apr_123",
	approveUrl: "https://example.com/approvals/apr_123/approve",
	denyUrl: "https://example.com/approvals/apr_123/deny",
};

describe("createWebhookChannel", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("sends POST to configured URL", async () => {
		const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const channel = createWebhookChannel({ url: "https://hooks.example.com/approvals" });
		const result = await channel.send(mockNotification);

		expect(result.ok).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("https://hooks.example.com/approvals");
		expect(init.method).toBe("POST");
		expect(init.headers["Content-Type"]).toBe("application/json");
	});

	it("includes custom headers", async () => {
		const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const channel = createWebhookChannel({
			url: "https://hooks.example.com",
			headers: { "X-Custom": "value" },
		});
		await channel.send(mockNotification);

		const [, init] = fetchMock.mock.calls[0];
		expect(init.headers["X-Custom"]).toBe("value");
	});

	it("returns retryable error on 5xx", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("error", { status: 503 })),
		);

		const channel = createWebhookChannel({ url: "https://hooks.example.com" });
		const result = await channel.send(mockNotification);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.retryable).toBe(true);
			expect(result.error.channel).toBe("webhook");
		}
	});

	it("returns non-retryable error on 4xx", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("bad", { status: 400 })),
		);

		const channel = createWebhookChannel({ url: "https://hooks.example.com" });
		const result = await channel.send(mockNotification);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.retryable).toBe(false);
		}
	});

	it("returns retryable error on network failure", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network down");
			}),
		);

		const channel = createWebhookChannel({ url: "https://hooks.example.com" });
		const result = await channel.send(mockNotification);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.retryable).toBe(true);
		}
	});

	it("has correct name", () => {
		const channel = createWebhookChannel({ url: "https://hooks.example.com" });
		expect(channel.name).toBe("webhook");
	});

	it("implements ChannelAdapter interface", () => {
		const channel: ChannelAdapter = createWebhookChannel({ url: "https://hooks.example.com" });
		expect(channel.name).toBeDefined();
		expect(channel.send).toBeDefined();
	});
});
