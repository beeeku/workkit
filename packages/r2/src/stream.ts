import { ValidationError } from "@workkit/errors";

/**
 * Read a ReadableStream into an ArrayBuffer.
 *
 * @param stream - The readable stream to consume.
 * @returns The full contents as an ArrayBuffer.
 *
 * @example
 * ```ts
 * const obj = await bucket.get('file.bin')
 * const buffer = await streamToBuffer(obj.body)
 * ```
 */
export async function streamToBuffer(stream: ReadableStream | null): Promise<ArrayBuffer> {
	assertStream(stream);
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let totalLength = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
		chunks.push(chunk);
		totalLength += chunk.byteLength;
	}

	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return result.buffer;
}

/**
 * Read a ReadableStream into a UTF-8 string.
 *
 * @param stream - The readable stream to consume.
 * @returns The full contents as a string.
 *
 * @example
 * ```ts
 * const obj = await bucket.get('readme.txt')
 * const text = await streamToText(obj.body)
 * ```
 */
export async function streamToText(stream: ReadableStream | null): Promise<string> {
	assertStream(stream);
	const buffer = await streamToBuffer(stream);
	return new TextDecoder().decode(buffer);
}

/**
 * Read a ReadableStream and parse its contents as JSON.
 *
 * @param stream - The readable stream to consume.
 * @returns The parsed JSON value, typed as T.
 *
 * @example
 * ```ts
 * const obj = await bucket.get('data.json')
 * const data = await streamToJson<MyData>(obj.body)
 * ```
 */
export async function streamToJson<T = unknown>(stream: ReadableStream | null): Promise<T> {
	const text = await streamToText(stream);
	try {
		return JSON.parse(text) as T;
	} catch (err) {
		throw new ValidationError("Failed to parse stream as JSON", [
			{
				path: ["body"],
				message: err instanceof Error ? err.message : "Invalid JSON",
				code: "WORKKIT_R2_INVALID_JSON",
			},
		]);
	}
}

/**
 * Assert that a value is a valid ReadableStream.
 */
function assertStream(stream: unknown): asserts stream is ReadableStream {
	if (!stream) {
		throw new ValidationError("Stream is null or undefined", [
			{
				path: ["stream"],
				message: "Expected a ReadableStream but received null/undefined",
				code: "WORKKIT_R2_NULL_STREAM",
			},
		]);
	}
	if (typeof (stream as any).getReader !== "function") {
		throw new ValidationError("Value is not a ReadableStream", [
			{
				path: ["stream"],
				message: "Expected a ReadableStream with getReader() method",
				code: "WORKKIT_R2_INVALID_STREAM",
			},
		]);
	}
}
