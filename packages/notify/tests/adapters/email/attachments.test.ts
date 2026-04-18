import { describe, expect, it } from "vitest";
import { loadAttachments } from "../../../src/adapters/email/attachments";
import { AttachmentTooLargeError } from "../../../src/adapters/email/errors";

interface FakeObject {
	bytes: Uint8Array;
	contentType?: string;
}

function fakeBucket(map: Record<string, FakeObject | null>): {
	get: (key: string) => Promise<{
		arrayBuffer: () => Promise<ArrayBuffer>;
		httpMetadata?: { contentType?: string };
	} | null>;
} {
	return {
		get: async (key: string) => {
			const obj = map[key];
			if (!obj) return null;
			return {
				arrayBuffer: async () =>
					obj.bytes.buffer.slice(obj.bytes.byteOffset, obj.bytes.byteOffset + obj.bytes.byteLength),
				httpMetadata: obj.contentType ? { contentType: obj.contentType } : undefined,
			};
		},
	};
}

describe("loadAttachments()", () => {
	it("returns blobs in input order with correct byte lengths", async () => {
		const bucket = fakeBucket({
			a: { bytes: new Uint8Array([1, 2]) },
			b: { bytes: new Uint8Array([3]) },
		});
		const out = await loadAttachments(bucket, [
			{ filename: "A", r2Key: "a" },
			{ filename: "B", r2Key: "b" },
		]);
		expect(out.map((o) => o.filename)).toEqual(["A", "B"]);
		expect(out[0]?.bytes.byteLength).toBe(2);
		expect(out[1]?.bytes.byteLength).toBe(1);
	});

	it("throws AttachmentTooLargeError when cap exceeded", async () => {
		const big = new Uint8Array(1000);
		const bucket = fakeBucket({ a: { bytes: big }, b: { bytes: big } });
		await expect(
			loadAttachments(
				bucket,
				[
					{ filename: "A", r2Key: "a" },
					{ filename: "B", r2Key: "b" },
				],
				{ maxTotalBytes: 1500 },
			),
		).rejects.toBeInstanceOf(AttachmentTooLargeError);
	});

	it("fails when an R2 key is missing", async () => {
		const bucket = fakeBucket({ a: null });
		await expect(loadAttachments(bucket, [{ filename: "A", r2Key: "a" }])).rejects.toThrow(
			/R2 object missing/,
		);
	});

	it("uses object content-type when type override absent", async () => {
		const bucket = fakeBucket({ a: { bytes: new Uint8Array([1]), contentType: "image/png" } });
		const out = await loadAttachments(bucket, [{ filename: "A", r2Key: "a" }]);
		expect(out[0]?.contentType).toBe("image/png");
	});
});
