export function generateExecutionId(): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return `wf_${Array.from(bytes, (b) => chars[b % chars.length]).join("")}`;
}

export function parseDuration(str: string): number {
	const match = str.match(/^(\d+)(ms|s|m|h|d)$/);
	if (!match) throw new Error(`Invalid duration: ${str}`);
	const value = Number.parseInt(match[1]!, 10);
	const unit = match[2]!;
	switch (unit) {
		case "ms":
			return value;
		case "s":
			return value * 1000;
		case "m":
			return value * 60 * 1000;
		case "h":
			return value * 60 * 60 * 1000;
		case "d":
			return value * 24 * 60 * 60 * 1000;
		default:
			throw new Error(`Unknown unit: ${unit}`);
	}
}

export function generateStepKey(index: number): string {
	return `wf:step:${index}`;
}
