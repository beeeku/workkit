import type { QuietHours } from "./types";

/**
 * Returns true when `at` falls inside the quiet-hours window (in the
 * recipient's IANA timezone). Handles midnight wrap (start > end) and DST
 * by computing local time via `Intl.DateTimeFormat` rather than offset
 * arithmetic.
 */
export function isWithinQuietHours(window: QuietHours, at: Date = new Date()): boolean {
	const [startH, startM] = parseHHmm(window.start);
	const [endH, endM] = parseHHmm(window.end);
	const local = getLocalHourMinute(at, window.timezone);
	const nowMin = local.hour * 60 + local.minute;
	const startMin = startH * 60 + startM;
	const endMin = endH * 60 + endM;

	if (startMin === endMin) return false; // empty window
	if (startMin < endMin) {
		return nowMin >= startMin && nowMin < endMin;
	}
	// midnight wrap, e.g. 22:00 → 06:00
	return nowMin >= startMin || nowMin < endMin;
}

function parseHHmm(s: string): [number, number] {
	const m = /^(\d{1,2}):(\d{2})$/.exec(s);
	if (!m) throw new Error(`invalid HH:mm: ${s}`);
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (!Number.isFinite(h) || !Number.isFinite(min) || h < 0 || h > 23 || min < 0 || min > 59) {
		throw new Error(`out-of-range HH:mm: ${s}`);
	}
	return [h, min];
}

function getLocalHourMinute(at: Date, timezone: string): { hour: number; minute: number } {
	const fmt = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
	const parts = fmt.formatToParts(at);
	let hour = 0;
	let minute = 0;
	for (const p of parts) {
		if (p.type === "hour") hour = Number(p.value) % 24; // some locales return "24" for midnight
		if (p.type === "minute") minute = Number(p.value);
	}
	return { hour, minute };
}
