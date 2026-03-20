import { ValidationError } from "@workkit/errors";

/**
 * Convert an S3 URI (s3://bucket/path/to/key) to a plain R2 key.
 *
 * Strips the `s3://bucket-name/` prefix and returns just the key path.
 *
 * @param s3Uri - The full S3 URI (e.g., "s3://my-bucket/path/to/file.txt")
 * @returns The R2-compatible key (e.g., "path/to/file.txt")
 *
 * @example
 * ```ts
 * fromS3Key('s3://my-bucket/path/to/file.txt')  // 'path/to/file.txt'
 * fromS3Key('s3://my-bucket/file.txt')           // 'file.txt'
 * ```
 */
export function fromS3Key(s3Uri: string): string {
	if (!s3Uri.startsWith("s3://")) {
		throw new ValidationError('Invalid S3 URI — must start with "s3://"', [
			{
				path: ["s3Uri"],
				message: `Expected s3:// prefix, got "${s3Uri.slice(0, 10)}..."`,
				code: "WORKKIT_R2_INVALID_S3_URI",
			},
		]);
	}

	const withoutProtocol = s3Uri.slice(5); // Remove 's3://'
	const slashIndex = withoutProtocol.indexOf("/");

	if (slashIndex === -1 || slashIndex === withoutProtocol.length - 1) {
		throw new ValidationError("S3 URI must include a key path after the bucket name", [
			{
				path: ["s3Uri"],
				message: "No key path found after bucket name",
				code: "WORKKIT_R2_S3_NO_KEY",
			},
		]);
	}

	return withoutProtocol.slice(slashIndex + 1);
}

/**
 * Convert an R2 key to an S3 URI format.
 *
 * @param key - The R2 object key (e.g., "path/to/file.txt")
 * @param bucket - The S3 bucket name (e.g., "my-bucket")
 * @returns The S3 URI (e.g., "s3://my-bucket/path/to/file.txt")
 *
 * @example
 * ```ts
 * toS3Key('path/to/file.txt', 'my-bucket')  // 's3://my-bucket/path/to/file.txt'
 * ```
 */
export function toS3Key(key: string, bucket: string): string {
	if (!key || key.length === 0) {
		throw new ValidationError("R2 key must be a non-empty string", [
			{
				path: ["key"],
				message: "Key is empty",
				code: "WORKKIT_R2_EMPTY_KEY",
			},
		]);
	}

	if (!bucket || bucket.length === 0) {
		throw new ValidationError("Bucket name must be a non-empty string", [
			{
				path: ["bucket"],
				message: "Bucket name is empty",
				code: "WORKKIT_R2_EMPTY_BUCKET",
			},
		]);
	}

	// Strip leading slash from key if present
	const normalizedKey = key.startsWith("/") ? key.slice(1) : key;

	return `s3://${bucket}/${normalizedKey}`;
}
