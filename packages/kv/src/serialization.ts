import type { SerializerType } from "./types";

export interface Serializer<T> {
	serialize(value: T): string | ArrayBuffer | ReadableStream;
	kvType: "json" | "text" | "arrayBuffer" | "stream";
}

export function getSerializer<T>(type: SerializerType): Serializer<T> {
	switch (type) {
		case "json":
			return {
				serialize: (value: T): string => JSON.stringify(value),
				kvType: "json",
			};
		case "text":
			return {
				serialize: (value: T): string => value as unknown as string,
				kvType: "text",
			};
		case "arrayBuffer":
			return {
				serialize: (value: T): ArrayBuffer => value as unknown as ArrayBuffer,
				kvType: "arrayBuffer",
			};
		case "stream":
			return {
				serialize: (value: T): ReadableStream => value as unknown as ReadableStream,
				kvType: "stream",
			};
	}
}
