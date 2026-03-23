export interface Serializer<T> {
	serialize(value: T): string | ArrayBuffer | ReadableStream;
	deserialize(raw: string): T;
}

/** Built-in JSON serializer (default) */
export const jsonSerializer: Serializer<any> = {
	serialize: (value) => JSON.stringify(value),
	deserialize: (raw) => JSON.parse(raw),
};

/** Built-in text serializer (passthrough) */
export const textSerializer: Serializer<string> = {
	serialize: (value) => value,
	deserialize: (raw) => raw,
};

/**
 * Resolve serializer from options.
 */
export function resolveSerializer<T>(option?: "json" | "text" | Serializer<T>): Serializer<T> {
	if (!option || option === "json") return jsonSerializer;
	if (option === "text") return textSerializer as Serializer<T>;
	return option;
}
