import type {
  TypedR2Object,
  MultipartUploadOptions,
  MultipartUploadSession,
  R2UploadedPart,
} from './types'
import { assertR2Binding, validateR2Key, wrapR2Error } from './errors'
import { ValidationError } from '@workkit/errors'

/** Minimum part size for multipart uploads: 5MB (except last part) */
const MIN_PART_SIZE = 5 * 1024 * 1024

/** Default part size: 10MB */
const DEFAULT_PART_SIZE = 10 * 1024 * 1024

/**
 * Start a multipart upload to R2.
 *
 * Returns a session object for uploading parts and completing/aborting
 * the upload. Parts can be uploaded out of order.
 *
 * @param bucket - The R2Bucket binding.
 * @param key - The object key for the final assembled object.
 * @param options - Optional part size, HTTP metadata, custom metadata.
 * @returns A MultipartUploadSession with uploadPart(), complete(), abort().
 *
 * @example
 * ```ts
 * const upload = await multipartUpload(env.MY_BUCKET, 'large-file.zip', {
 *   partSize: 10 * 1024 * 1024,
 * })
 * await upload.uploadPart(1, part1Data)
 * await upload.uploadPart(2, part2Data)
 * const result = await upload.complete()
 * ```
 */
export async function multipartUpload(
  bucket: R2Bucket,
  key: string,
  options?: MultipartUploadOptions,
): Promise<MultipartUploadSession> {
  assertR2Binding(bucket)
  validateR2Key(key)

  const partSize = options?.partSize ?? DEFAULT_PART_SIZE

  if (partSize < MIN_PART_SIZE) {
    throw new ValidationError(
      `Multipart part size must be at least ${MIN_PART_SIZE} bytes (5MB), got ${partSize}`,
      [
        {
          path: ['partSize'],
          message: `Minimum part size is 5MB`,
          code: 'WORKKIT_R2_PART_TOO_SMALL',
        },
      ],
    )
  }

  const createOptions: any = {}
  if (options?.httpMetadata) createOptions.httpMetadata = options.httpMetadata
  if (options?.customMetadata) createOptions.customMetadata = options.customMetadata

  let multipartUploadHandle: any
  try {
    multipartUploadHandle = await (bucket as any).createMultipartUpload(key, createOptions)
  } catch (err) {
    wrapR2Error(err, { key, operation: 'createMultipartUpload' })
  }

  const uploadedParts: R2UploadedPart[] = []

  return {
    get uploadId(): string {
      return multipartUploadHandle.uploadId
    },

    async uploadPart(
      partNumber: number,
      data: ArrayBuffer | ReadableStream | string | Blob,
    ): Promise<R2UploadedPart> {
      if (partNumber < 1 || partNumber > 10000) {
        throw new ValidationError(
          `Part number must be between 1 and 10000, got ${partNumber}`,
          [
            {
              path: ['partNumber'],
              message: `Invalid part number: ${partNumber}`,
              code: 'WORKKIT_R2_INVALID_PART_NUMBER',
            },
          ],
        )
      }

      try {
        const part = await multipartUploadHandle.uploadPart(partNumber, data)
        const uploadedPart: R2UploadedPart = {
          partNumber: part.partNumber,
          etag: part.etag,
        }
        uploadedParts.push(uploadedPart)
        return uploadedPart
      } catch (err) {
        wrapR2Error(err, {
          key,
          operation: 'uploadPart',
          uploadId: multipartUploadHandle.uploadId,
        })
      }
    },

    async complete(): Promise<TypedR2Object> {
      if (uploadedParts.length === 0) {
        throw new ValidationError('Cannot complete multipart upload with no uploaded parts', [
          {
            path: ['parts'],
            message: 'At least one part must be uploaded before completing',
            code: 'WORKKIT_R2_NO_PARTS',
          },
        ])
      }

      // Sort parts by part number for completion
      const sortedParts = [...uploadedParts].sort((a, b) => a.partNumber - b.partNumber)

      try {
        const result = await multipartUploadHandle.complete(sortedParts)
        return result as unknown as TypedR2Object
      } catch (err) {
        wrapR2Error(err, {
          key,
          operation: 'completeMultipartUpload',
          uploadId: multipartUploadHandle.uploadId,
        })
      }
    },

    async abort(): Promise<void> {
      try {
        await multipartUploadHandle.abort()
      } catch (err) {
        wrapR2Error(err, {
          key,
          operation: 'abortMultipartUpload',
          uploadId: multipartUploadHandle.uploadId,
        })
      }
    },
  }
}
