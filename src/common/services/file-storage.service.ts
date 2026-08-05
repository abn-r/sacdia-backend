export const FILE_STORAGE_SERVICE = 'FILE_STORAGE_SERVICE';

export enum StorageBucketAlias {
  USER_PROFILES = 'USER_PROFILES',
  HONORS_IMAGES = 'HONORS_IMAGES',
  HONORS_PDF = 'HONORS_PDF',
  USERS_HONORS = 'USERS_HONORS',
  USERS_HONORS_CERT = 'USERS_HONORS_CERT',
  CLASSES_DOCUMENTS = 'CLASSES_DOCUMENTS',
  ACTIVITIES_IMAGES = 'ACTIVITIES_IMAGES',
  EVIDENCE_FILES = 'EVIDENCE_FILES',
  INSURANCE_EVIDENCE = 'INSURANCE_EVIDENCE',
  CLASS_EVIDENCE = 'CLASS_EVIDENCE',
  RESOURCES_FILES = 'RESOURCES_FILES',
  ACHIEVEMENTS_BADGES = 'ACHIEVEMENTS_BADGES',
  /**
   * Private bucket for GDPR data export JSON files.
   * Objects are served via presigned URLs (TTL 15 min) — never public.
   * Env vars: R2_BUCKET_DATA_EXPORTS, R2_PUBLIC_URL_DATA_EXPORTS (required).
   */
  DATA_EXPORTS = 'DATA_EXPORTS',
  /**
   * Private bucket for canonical monthly-report PDF artifacts.
   * Objects are overwritten at a deterministic key and served through signed
   * URLs only. Env vars: R2_BUCKET_MONTHLY_REPORTS,
   * R2_PUBLIC_URL_MONTHLY_REPORTS and R2_KEY_PREFIX_MONTHLY_REPORTS.
   */
  MONTHLY_REPORTS = 'MONTHLY_REPORTS',
  /**
   * Private bucket for materiales payment receipt files (comprobantes).
   * Objects are served via signed download URLs (TTL 15 min) — never public.
   * Key format: materiales/comprobantes/{folio}/{uuid}.{ext}
   * Env vars: R2_BUCKET_MATERIALES_COMPROBANTES, R2_PUBLIC_URL_MATERIALES_COMPROBANTES (required).
   * Optional: R2_KEY_PREFIX_MATERIALES_COMPROBANTES (default: 'materiales/comprobantes').
   */
  MATERIALES_COMPROBANTES = 'MATERIALES_COMPROBANTES',
  /**
   * Private bucket for camporee payment voucher files (image/PDF).
   * Objects are served via signed download URLs (TTL 15 min) — never public.
   * Key format: camporee-payments/{camporeeId}/{paymentId}/{uuid}.{ext}
   * Env vars: R2_BUCKET_CAMPOREE_PAYMENT_VOUCHERS, R2_PUBLIC_URL_CAMPOREE_PAYMENT_VOUCHERS (required).
   * Optional: R2_KEY_PREFIX_CAMPOREE_PAYMENT_VOUCHERS (default: 'camporee-payments').
   */
  CAMPOREE_PAYMENT_VOUCHERS = 'CAMPOREE_PAYMENT_VOUCHERS',
}

export type UploadFileOptions = {
  contentType: string;
  overwrite?: boolean;
};

export type UploadedFileResult = {
  key: string;
  url: string;
};

export type SignedUrlOptions = {
  expiresInSeconds?: number;
};

export type SignedUploadUrlOptions = SignedUrlOptions & {
  contentType: string;
  contentLength?: number;
};

export type SignedUploadResult = {
  url: string;
  key: string;
  expiresInSeconds: number;
};

export type StoredObjectInfo = {
  size: number;
  contentType: string | null;
};

export interface FileStorageService {
  upload(
    bucketAlias: StorageBucketAlias,
    key: string,
    buffer: Buffer,
    options: UploadFileOptions,
  ): Promise<UploadedFileResult>;
  deleteMany(bucketAlias: StorageBucketAlias, keys: string[]): Promise<void>;
  extractKeyFromPublicUrl(
    bucketAlias: StorageBucketAlias,
    publicUrl: string,
  ): string | null;
  getSignedDownloadUrl(
    bucketAlias: StorageBucketAlias,
    keyOrPublicUrl: string,
    options?: SignedUrlOptions,
  ): Promise<string>;
  /**
   * Generate a presigned PUT URL so the browser can upload directly to R2,
   * bypassing the Next.js Server Action and NestJS multipart body limits.
   */
  getSignedUploadUrl(
    bucketAlias: StorageBucketAlias,
    key: string,
    options: SignedUploadUrlOptions,
  ): Promise<SignedUploadResult>;
  /**
   * HEAD an object to confirm the client-side upload finished. Returns null
   * when the key is missing (caller treats as "upload incomplete").
   */
  getObjectInfo(
    bucketAlias: StorageBucketAlias,
    key: string,
  ): Promise<StoredObjectInfo | null>;
  /**
   * Resolve a stored key to its public CDN URL synchronously.
   * Only valid for public buckets (isPublic: true). Throws if the bucket is private.
   */
  resolvePublicUrl(bucketAlias: StorageBucketAlias, key: string): string;
}
