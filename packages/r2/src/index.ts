export { r2 } from './client'

export type {
  WorkkitR2,
  R2ClientOptions,
  R2GetOptions,
  R2PutOptions,
  R2ListOptions,
  R2ListPage,
  R2ListInclude,
  R2ConditionalOptions,
  R2Range,
  TypedR2Object,
  TypedR2ObjectBody,
  R2HTTPMetadata,
  R2Checksums,
  R2Operation,
  R2ErrorContext,
  PresignedUrlOptions,
  MultipartUploadOptions,
  MultipartUploadSession,
  R2UploadedPart,
} from './types'

// Presigned URL generation
export { createPresignedUrl } from './presigned'

// Streaming helpers
export { streamToBuffer, streamToText, streamToJson } from './stream'

// Multipart upload
export { multipartUpload } from './multipart'

// Migration helpers (S3 compatibility)
export { fromS3Key, toS3Key } from './migration'

// Error utilities
export { wrapR2Error, assertR2Binding, validateR2Key } from './errors'
