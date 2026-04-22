export interface ParsedFrame {
	event: string;
	id?: number;
	data: string;
}

export function createSseParser(onFrame: (frame: ParsedFrame) => void): (chunk: string) => void {
	let buf = "";
	let event = "message";
	let id: number | undefined;
	let dataLines: string[] = [];

	const reset = () => {
		event = "message";
		id = undefined;
		dataLines = [];
	};

	const dispatch = () => {
		if (dataLines.length === 0 && id === undefined && event === "message") return;
		onFrame({ event, id, data: dataLines.join("\n") });
		reset();
	};

	const consumeLine = (line: string) => {
		if (line === "") {
			dispatch();
			return;
		}
		if (line.startsWith(":")) return; // comment
		const colon = line.indexOf(":");
		const field = colon === -1 ? line : line.slice(0, colon);
		let value = colon === -1 ? "" : line.slice(colon + 1);
		if (value.startsWith(" ")) value = value.slice(1);
		if (field === "event") event = value;
		else if (field === "id") {
			// Strict digit match — parseInt("500abc") would be 500.
			if (/^\d+$/.test(value)) id = Number.parseInt(value, 10);
		} else if (field === "data") dataLines.push(value);
	};

	return (chunk: string) => {
		buf += chunk;
		let idx: number;
		while ((idx = buf.indexOf("\n")) !== -1) {
			let line = buf.slice(0, idx);
			buf = buf.slice(idx + 1);
			// Tolerate CRLF line endings — any HTTP proxy in front of the broker
			// may rewrite LF to CRLF; without this strip, `field = "event\r"`.
			if (line.endsWith("\r")) line = line.slice(0, -1);
			consumeLine(line);
		}
	};
}
