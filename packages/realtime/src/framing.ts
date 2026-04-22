const encoder = new TextEncoder();

export interface EncodeEventInput {
	event: string;
	data: string;
	id?: number;
}

export function encodeEvent({ event, data, id }: EncodeEventInput): Uint8Array {
	let out = "";
	if (event !== "") out += `event: ${event}\n`;
	if (id !== undefined) out += `id: ${id}\n`;
	const lines = data.split("\n");
	for (const line of lines) out += `data: ${line}\n`;
	out += "\n";
	return encoder.encode(out);
}

export function encodeComment(text: string): Uint8Array {
	return encoder.encode(`: ${text.replace(/\n/g, "")}\n\n`);
}
