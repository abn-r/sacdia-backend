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
}
