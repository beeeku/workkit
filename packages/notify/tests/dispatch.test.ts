import { describe, expect, it } from "vitest";
import { buildRegistry } from "../src/adapters";
import { dispatch } from "../src/dispatch";
import type {
	Adapter,
	AdapterSendArgs,
	ChannelTemplate,
	DispatchJob,
	NotifyDeps,
	Recipient,
} from "../src/types";
import { MemoryD1, seed } from "./_mocks";

interface MockAdapter extends Adapter<unknown> {
	calls: AdapterSendArgs<unknown>[];
}
function mockAdapter(
	resolution: { status: "sent" | "delivered" | "failed"; error?: string } = { status: "sent" },
): MockAdapter {
	const a: MockAdapter = {
		calls: [],
		async send(args) {
			a.calls.push(args);
			return { status: resolution.status, providerId: "p_x", error: resolution.error };
		},
	};
	return a;
}

function recipient(extra?: Partial<Recipient>): Recipient {
	return {
		userId: "u1",
		channels: [
			{ channel: "email", address: "x@example.com", verified: true },
			{ channel: "whatsapp", address: "+919999999999", verified: true },
		],
		...extra,
	};
}

function templates(): Record<string, ChannelTemplate<unknown>> {
	return { email: {}, whatsapp: {}, inApp: {} };
}

function job(extra: Partial<DispatchJob<unknown>> = {}): DispatchJob<unknown> {
	return {
		id: "j1",
		userId: "u1",
		notificationId: "pre-market-brief",
		payload: {},
		idempotencyKey: extra.idempotencyKey ?? "k_default",
		priority: "normal",
		mode: "live",
		createdAt: 0,
		...extra,
	};
}

function depsFor(
	d1: MemoryD1,
	adapters: Record<string, Adapter<unknown>>,
	rec: Recipient | null,
): NotifyDeps {
	return {
		db: d1,
		resolver: async () => rec,
		adapters,
		now: () => 1700000000000,
	};
}

describe("dispatch()", () => {
	it("sends through the first eligible channel and stops", async () => {
		const d1 = new MemoryD1();
		const email = mockAdapter();
		const wa = mockAdapter();
		const deps = depsFor(d1, { email, whatsapp: wa }, recipient());
		const out = await dispatch(deps, buildRegistry(deps.adapters), {
			job: job(),
			template: templates(),
			fallback: ["email", "whatsapp"],
		});
		expect(out.finalStatus).toBe("sent");
		expect(out.channelAttempted).toBe("email");
		expect(email.calls).toHaveLength(1);
		expect(wa.calls).toHaveLength(0);
	});

	it("falls back to the next channel when the first adapter returns 'failed'", async () => {
		const d1 = new MemoryD1();
		const email = mockAdapter({ status: "failed", error: "bounced" });
		const wa = mockAdapter({ status: "sent" });
		const deps = depsFor(d1, { email, whatsapp: wa }, recipient());
		const out = await dispatch(deps, buildRegistry(deps.adapters), {
			job: job(),
			template: templates(),
			fallback: ["email", "whatsapp"],
		});
		expect(out.finalStatus).toBe("sent");
		expect(out.channelAttempted).toBe("whatsapp");
		expect(email.calls).toHaveLength(1);
		expect(wa.calls).toHaveLength(1);
	});

	it("returns 'duplicate' when idempotency_key is already present", async () => {
		const d1 = new MemoryD1();
		seed(d1, "notification_deliveries", [
			{
				id: "existing",
				user_id: "u1",
				notification_id: "pre-market-brief",
				channel: "email",
				status: "sent",
				idempotency_key: "k_existing",
				payload: null,
				provider_id: "p",
				error: null,
				attempted_at: 0,
				delivered_at: null,
			},
		]);
		const email = mockAdapter();
		const deps = depsFor(d1, { email }, recipient());
		const out = await dispatch(deps, buildRegistry(deps.adapters), {
			job: job({ idempotencyKey: "k_existing" }),
			template: templates(),
			fallback: ["email"],
		});
		expect(out.finalStatus).toBe("duplicate");
		expect(email.calls).toHaveLength(0);
	});

	it("re-checks opt-out at dispatch time and skips the channel", async () => {
		const d1 = new MemoryD1();
		seed(d1, "notification_optouts", [
			{
				user_id: "u1",
				channel: "email",
				notification_id: "pre-market-brief",
				opted_out_at: 100,
				reason: null,
			},
		]);
		const email = mockAdapter();
		const wa = mockAdapter();
		const deps = depsFor(d1, { email, whatsapp: wa }, recipient());
		const out = await dispatch(deps, buildRegistry(deps.adapters), {
			job: job(),
			template: templates(),
			fallback: ["email", "whatsapp"],
		});
		expect(email.calls).toHaveLength(0);
		expect(wa.calls).toHaveLength(1);
		expect(out.channelAttempted).toBe("whatsapp");
	});

	it("returns 'skipped' when all candidate channels are opted out", async () => {
		const d1 = new MemoryD1();
		seed(d1, "notification_optouts", [
			{
				user_id: "u1",
				channel: "email",
				notification_id: "pre-market-brief",
				opted_out_at: 0,
				reason: null,
			},
			{
				user_id: "u1",
				channel: "whatsapp",
				notification_id: "pre-market-brief",
				opted_out_at: 0,
				reason: null,
			},
		]);
		const email = mockAdapter();
		const wa = mockAdapter();
		const deps = depsFor(d1, { email, whatsapp: wa }, recipient());
		const out = await dispatch(deps, buildRegistry(deps.adapters), {
			job: job(),
			template: templates(),
			fallback: ["email", "whatsapp"],
		});
		expect(out.finalStatus).toBe("skipped");
		expect(email.calls).toHaveLength(0);
		expect(wa.calls).toHaveLength(0);
	});

	it("records 'sent' to test-sink without calling the adapter when mode='test'", async () => {
		const d1 = new MemoryD1();
		const email = mockAdapter();
		const deps = depsFor(d1, { email }, recipient());
		const out = await dispatch(deps, buildRegistry(deps.adapters), {
			job: job({ mode: "test" }),
			template: templates(),
			fallback: ["email"],
		});
		expect(out.finalStatus).toBe("sent");
		expect(email.calls).toHaveLength(0);
	});
});
