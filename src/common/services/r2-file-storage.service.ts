import { Injectable, Logger } from '@nestjs/common';
import { AppInternalServerErrorException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  FileStorageService,
  SignedUploadResult,
  SignedUploadUrlOptions,
  SignedUrlOptions,
  StorageBucketAlias,
  StoredObjectInfo,
  UploadFileOptions,
  UploadedFileResult,
} from './file-storage.service';

type R2BucketConfig = {
  bucket: string;
  publicBaseUrl: string;
  keyPrefix: string;
  isPublic: boolean;
};

@Injectable()
export class R2FileStorageService implements FileStorageService {
  private readonly logger = new Logger(R2FileStorageService.name);
  private static readonly DEFAULT_SIGNED_URL_EXPIRATION_SECONDS = 300;
  private s3Client: S3Client | null = null;

  constructor(private readonly configService: ConfigService) {}

  async upload(
    bucketAlias: StorageBucketAlias,
    key: string,
    buffer: Buffer,
    options: UploadFileOptions,
  ): Promise<UploadedFileResult> {
    const config = this.getBucketConfig(bucketAlias);
    const normalizedKey = this.normalizeKey(key);
    const objectKey = this.toObjectKey(config.keyPrefix, normalizedKey);
    const overwrite = options.overwrite ?? false;

    if (!overwrite) {
      await this.assertKeyDoesNotExist(config.bucket, objectKey);
    }

    try {
      await this.getClient().send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
          Body: buffer,
          ContentType: options.contentType,
        }),
      );
    } catch (error) {
      this.logger.error(
        `Error uploading object to R2 bucket=${config.bucket} key=${objectKey}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new AppInternalServerErrorException(ErrorCode.R2_UPLOAD_FAILED);
    }

    return {
      key: objectKey,
      // objectKey already includes the keyPrefix. buildPublicUrl will detect
      // whether the prefix is already embedded in publicBaseUrl (embedded-prefix
      // pattern) and avoid doubling it, or prepend it when the base URL is bare.
      url: this.buildPublicUrl(
        config.publicBaseUrl,
        objectKey,
        config.keyPrefix,
      ),
    };
  }

  async deleteMany(
    bucketAlias: StorageBucketAlias,
    keys: string[],
  ): Promise<void> {
    const { bucket } = this.getBucketConfig(bucketAlias);
    const normalizedKeys = [
      ...new Set(keys.map((key) => this.normalizeKey(key))),
    ];

    if (normalizedKeys.length === 0) return;

    try {
      const response = await this.getClient().send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: normalizedKeys.map((key) => ({ Key: key })),
            Quiet: true,
          },
        }),
      );

      if (response.Errors && response.Errors.length > 0) {
        this.logger.error(
          `R2 partial delete failure in bucket=${bucket}: ${response.Errors.map(
            (item) => `${item.Key || 'unknown'} (${item.Code || 'unknown'})`,
          ).join(', ')}`,
        );
        throw new AppInternalServerErrorException(ErrorCode.R2_DELETE_FAILED);
      }
    } catch (error) {
      if (error instanceof AppInternalServerErrorException) throw error;
      this.logger.error(
        `Error deleting objects from R2 bucket=${bucket}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new AppInternalServerErrorException(ErrorCode.R2_DELETE_FAILED);
    }
  }

  extractKeyFromPublicUrl(
    bucketAlias: StorageBucketAlias,
    publicUrl: string,
  ): string | null {
    if (!publicUrl) return null;

    const { publicBaseUrl, keyPrefix } = this.getBucketConfig(bucketAlias);
    const normalizedBase = this.normalizeBaseUrl(publicBaseUrl);
    const normalizedPublicUrl = this.normalizeUrl(publicUrl);
    const prefix = `${normalizedBase}/`;

    if (!normalizedPublicUrl.startsWith(prefix)) {
      return null;
    }

    const encodedRelativeKey = normalizedPublicUrl.slice(prefix.length);
    if (!encodedRelativeKey) return null;
    const relativeKey = decodeURIComponent(encodedRelativeKey);

    // relativeKey is the path segment extracted directly from the URL.
    // For a correctly-stored URL it already includes the keyPrefix
    // (e.g. "user-profiles/photo-abc.jpeg"). toObjectKey would double-prepend
    // the prefix in that case, so we guard with hasKeyPrefix first.
    if (this.hasKeyPrefix(keyPrefix, relativeKey)) {
      return this.normalizeKey(relativeKey);
    }

    return this.toObjectKey(keyPrefix, relativeKey);
  }

  async getSignedDownloadUrl(
    bucketAlias: StorageBucketAlias,
    keyOrPublicUrl: string,
    options?: SignedUrlOptions,
  ): Promise<string> {
    if (!keyOrPublicUrl?.trim()) {
      return keyOrPublicUrl;
    }

    const config = this.getBucketConfig(bucketAlias);
    const objectKey = this.resolveObjectKey(bucketAlias, keyOrPublicUrl);

    if (!objectKey) {
      return keyOrPublicUrl;
    }

    if (config.isPublic) {
      // objectKey carries the full key with prefix. buildPublicUrl handles the
      // embedded-vs-bare publicBaseUrl distinction automatically.
      return this.buildPublicUrl(
        config.publicBaseUrl,
        objectKey,
        config.keyPrefix,
      );
    }

    const expiresIn = this.resolveSignedUrlExpiration(
      options?.expiresInSeconds,
    );
    try {
      return await getSignedUrl(
        this.getClient(),
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
        }),
        { expiresIn },
      );
    } catch (error) {
      this.logger.error(
        `Error generating signed URL for R2 bucket=${config.bucket} key=${objectKey}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new AppInternalServerErrorException(ErrorCode.R2_SIGNED_URL_FAILED);
    }
  }

  async getSignedUploadUrl(
    bucketAlias: StorageBucketAlias,
    key: string,
    options: SignedUploadUrlOptions,
  ): Promise<SignedUploadResult> {
    const config = this.getBucketConfig(bucketAlias);
    const normalizedKey = this.normalizeKey(key);
    const objectKey = this.toObjectKey(config.keyPrefix, normalizedKey);
    const expiresIn = this.resolveSignedUrlExpiration(options.expiresInSeconds);

    try {
      const url = await getSignedUrl(
        this.getClient(),
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
          ContentType: options.contentType,
          ...(options.contentLength != null && {
            ContentLength: options.contentLength,
          }),
        }),
        { expiresIn },
      );

      return { url, key: objectKey, expiresInSeconds: expiresIn };
    } catch (error) {
      this.logger.error(
        `Error generating signed PUT URL for R2 bucket=${config.bucket} key=${objectKey}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new AppInternalServerErrorException(ErrorCode.R2_SIGNED_URL_FAILED);
    }
  }

  async getObjectInfo(
    bucketAlias: StorageBucketAlias,
    key: string,
  ): Promise<StoredObjectInfo | null> {
    const config = this.getBucketConfig(bucketAlias);
    const normalizedKey = this.normalizeKey(key);
    const objectKey = this.hasKeyPrefix(config.keyPrefix, normalizedKey)
      ? normalizedKey
      : this.toObjectKey(config.keyPrefix, normalizedKey);

    try {
      const response = await this.getClient().send(
        new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey }),
      );
      return {
        size: response.ContentLength ?? 0,
        contentType: response.ContentType ?? null,
      };
    } catch (error) {
      if (this.isNotFoundError(error)) return null;
      this.logger.error(
        `Error HEAD-checking R2 bucket=${config.bucket} key=${objectKey}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new AppInternalServerErrorException(ErrorCode.R2_VALIDATION_FAILED);
    }
  }

  /**
   * Resolve a stored object key to its public CDN URL synchronously.
   * Only valid for buckets configured with isPublic: true (e.g. ACHIEVEMENTS_BADGES).
   * Throws InternalServerErrorException if called on a private bucket.
   */
  resolvePublicUrl(bucketAlias: StorageBucketAlias, key: string): string {
    const config = this.getBucketConfig(bucketAlias);
    if (!config.isPublic) {
      throw new AppInternalServerErrorException(ErrorCode.R2_VALIDATION_FAILED);
    }
    // Normalize the incoming key and ensure it carries the bucket prefix.
    // - If the key already starts with the prefix (full object key), use it as-is.
    // - If it is a bare filename (no prefix), prepend the prefix via toObjectKey.
    // We must NOT use toRelativeKey here — that was Bug #1 (stripped the prefix).
    const normalized = this.normalizeKey(key);
    const objectKey = this.hasKeyPrefix(config.keyPrefix, normalized)
      ? normalized
      : this.toObjectKey(config.keyPrefix, normalized);
    return this.buildPublicUrl(
      config.publicBaseUrl,
      objectKey,
      config.keyPrefix,
    );
  }

  /**
   * Build the CDN public URL for an object stored in R2.
   *
   * ENV INCONSISTENCY (2026-04):
   *   Some buckets embed the keyPrefix as a path segment in publicBaseUrl
   *   (e.g. HONORS_IMAGES → "https://pub.r2.dev/honors", prefix = "honors").
   *   Others expose a bare domain and rely on the prefix being prepended here
   *   (e.g. USER_PROFILES → "https://pub-xxx.r2.dev", prefix = "user-profiles").
   *
   *   When the prefix is already embedded in publicBaseUrl we must NOT inject it
   *   again — doing so produces double-prefix paths like ".../honors/honors/img.png".
   *   When it is NOT embedded we must prepend it so the full object key appears in
   *   the URL (Bug #1 regression: omitting it broke prefixed buckets).
   *
   *   Future cleanup: standardise all R2_PUBLIC_URL_* vars to bare domain form so
   *   the service always controls the full path.
   *
   * @param publicBaseUrl  Configured public base URL for the bucket.
   * @param objectKey      Full R2 object key — already includes the keyPrefix
   *                       (e.g. "user-profiles/photo.jpg", "honors/badge.png").
   * @param keyPrefix      The bucket's keyPrefix as configured.
   */
  private buildPublicUrl(
    publicBaseUrl: string,
    objectKey: string,
    keyPrefix: string,
  ): string {
    const normalizedBase = this.normalizeBaseUrl(publicBaseUrl);
    const normalizedPrefix = keyPrefix.trim().replace(/^\/+|\/+$/g, '');

    // Determine which key segment to append after the base URL.
    // If the prefix is already embedded in publicBaseUrl (e.g. ".../honors"),
    // we strip the prefix from objectKey so it isn't duplicated.
    // Otherwise we use objectKey as-is (it already carries the prefix).
    let pathKey: string;
    if (
      normalizedPrefix &&
      this.isKeyPrefixInPublicBaseUrl(normalizedBase, normalizedPrefix)
    ) {
      pathKey = this.toRelativeKey(normalizedPrefix, objectKey);
    } else {
      pathKey = objectKey;
    }

    const normalizedKey = this.normalizeKey(pathKey)
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `${normalizedBase}/${normalizedKey}`;
  }

  /**
   * Returns true when the keyPrefix is already embedded as the last path
   * segment of publicBaseUrl (or part of its path).
   *
   * Examples:
   *   isKeyPrefixInPublicBaseUrl("https://pub.r2.dev/honors", "honors") → true
   *   isKeyPrefixInPublicBaseUrl("https://pub.r2.dev/secure-documents/activities", "activities") → true
   *   isKeyPrefixInPublicBaseUrl("https://pub-xxx.r2.dev", "user-profiles") → false
   *   isKeyPrefixInPublicBaseUrl("https://pub.r2.dev", "") → false
   */
  private isKeyPrefixInPublicBaseUrl(
    publicBaseUrl: string,
    keyPrefix: string,
  ): boolean {
    const normalizedPrefix = keyPrefix.trim().replace(/^\/+|\/+$/g, '');
    if (!normalizedPrefix) return false;
    try {
      const url = new URL(publicBaseUrl);
      const basePath = url.pathname.trim().replace(/^\/+|\/+$/g, '');
      if (!basePath) return false;
      // Match if the basePath IS the prefix, ends with /prefix, or starts with prefix/
      return (
        basePath === normalizedPrefix ||
        basePath.endsWith(`/${normalizedPrefix}`) ||
        basePath.startsWith(`${normalizedPrefix}/`)
      );
    } catch {
      return false;
    }
  }

  private async assertKeyDoesNotExist(bucket: string, key: string) {
    try {
      await this.getClient().send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
      throw new AppInternalServerErrorException(ErrorCode.R2_UPLOAD_FAILED);
    } catch (error) {
      if (
        error instanceof AppInternalServerErrorException ||
        this.isNotFoundError(error)
      ) {
        if (this.isNotFoundError(error)) return;
        throw error;
      }

      this.logger.error(
        `Error checking object existence in R2 bucket=${bucket} key=${key}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new AppInternalServerErrorException(ErrorCode.R2_VALIDATION_FAILED);
    }
  }

  private isNotFoundError(error: unknown) {
    if (!error || typeof error !== 'object') return false;

    const maybeError = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return (
      maybeError.name === 'NotFound' ||
      maybeError.$metadata?.httpStatusCode === 404
    );
  }

  private getClient() {
    if (this.s3Client) {
      return this.s3Client;
    }

    const accountId = this.getRequiredEnv('R2_ACCOUNT_ID');
    const accessKeyId = this.getRequiredEnv('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.getRequiredEnv('R2_SECRET_ACCESS_KEY');
    const region = this.configService.get<string>('R2_REGION') || 'auto';

    this.s3Client = new S3Client({
      region,
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true,
    });

    return this.s3Client;
  }

  private getBucketConfig(bucketAlias: StorageBucketAlias): R2BucketConfig {
    switch (bucketAlias) {
      case StorageBucketAlias.USER_PROFILES:
        return {
          bucket: this.getRequiredEnv('R2_BUCKET_USER_PROFILES'),
          publicBaseUrl: this.getRequiredEnv('R2_PUBLIC_URL_USER_PROFILES'),
          keyPrefix: this.getOptionalEnv('R2_KEY_PREFIX_USER_PROFILES'),
          isPublic: true,
        };
      case StorageBucketAlias.HONORS_IMAGES:
        return {
          bucket: this.getRequiredEnv('R2_BUCKET_HONORS_IMAGES'),
          publicBaseUrl: this.getRequiredEnv('R2_PUBLIC_URL_HONORS_IMAGES'),
          keyPrefix: this.getOptionalEnv('R2_KEY_PREFIX_HONORS_IMAGES'),
          isPublic: true,
        };
      case StorageBucketAlias.HONORS_PDF:
        return {
          bucket: this.getRequiredEnv('R2_BUCKET_HONORS_PDF'),
          publicBaseUrl: this.getRequiredEnv('R2_PUBLIC_URL_HONORS_PDF'),
          keyPrefix: this.getOptionalEnv('R2_KEY_PREFIX_HONORS_PDF'),
          isPublic: true,
        };
      case StorageBucketAlias.USERS_HONORS:
        return {
          bucket: this.getRequiredEnv('R2_BUCKET_USERS_HONORS'),
          publicBaseUrl: this.getRequiredEnv('R2_PUBLIC_URL_USERS_HONORS'),
          keyPrefix: this.getOptionalEnv('R2_KEY_PREFIX_USERS_HONORS'),
          isPublic: false,
        };
      case StorageBucketAlias.USERS_HONORS_CERT:
        return {
          bucket: this.getRequiredEnv('R2_BUCKET_USERS_HONORS_CERT'),
          publicBaseUrl: this.getRequiredEnv('R2_PUBLIC_URL_USERS_HONORS_CERT'),
          keyPrefix: this.getOptionalEnv('R2_KEY_PREFIX_USERS_HONORS_CERT'),
          isPublic: false,
        };
      case StorageBucketAlias.CLASSES_DOCUMENTS:
        return {
          bucket: this.getRequiredEnv('R2_BUCKET_CLASSES_DOCUMENTS'),
          publicBaseUrl: this.getRequiredEnv('R2_PUBLIC_URL_CLASSES_DOCUMENTS'),
          keyPrefix: this.getOptionalEnv('R2_KEY_PREFIX_CLASSES_DOCUMENTS'),
          isPublic: true,
        };
      case StorageBucketAlias.ACTIVITIES_IMAGES:
        return {
          bucket: this.getRequiredEnv('R2_BUCKET_ACTIVITIES_IMAGES'),
          publicBaseUrl: this.getRequiredEnv('R2_PUBLIC_URL_ACTIVITIES_IMAGES'),
          keyPrefix: this.getOptionalEnv('R2_KEY_PREFIX_ACTIVITIES_IMAGES'),
          isPublic: false,
        };
      case StorageBucketAlias.EVIDENCE_FILES:
        return {
          bucket: this.getRequiredEnv('R2_BUCKET_EVIDENCE_FILES'),
          publicBaseUrl: this.getRequiredEnv('R2_PUBLIC_URL_EVIDENCE_FILES'),
          keyPrefix: this.getOptionalEnv('R2_KEY_PREFIX_EVIDENCE_FILES'),
          isPublic: false,
        };
      case StorageBucketAlias.INSURANCE_EVIDENCE:
        return {
          bucket: this.getRequiredEnv('R2_BUCKET_INSURANCE_EVIDENCE'),
          publicBaseUrl: this.getRequiredEnv(
            'R2_PUBLIC_URL_INSURANCE_EVIDENCE',
          ),
          keyPrefix: this.getOptionalEnv('R2_KEY_PREFIX_INSURANCE_EVIDENCE'),
          isPublic: false,
        };
      case StorageBucketAlias.CLASS_EVIDENCE:
        return {
          bucket: this.getRequiredEnv('R2_BUCKET_EVIDENCE_FILES'),
          publicBaseUrl: this.getRequiredEnv('R2_PUBLIC_URL_EVIDENCE_FILES'),
          keyPrefix: this.getOptionalEnv(
            'R2_KEY_PREFIX_CLASS_EVIDENCE',
            'class-evidence',
          ),
          isPublic: false,
        };
      case StorageBucketAlias.RESOURCES_FILES:
        return {
          bucket: this.getRequiredEnv('R2_BUCKET_RESOURCES_FILES'),
          publicBaseUrl: this.getRequiredEnv('R2_PUBLIC_URL_RESOURCES_FILES'),
          keyPrefix: this.getOptionalEnv(
            'R2_KEY_PREFIX_RESOURCES_FILES',
            'resources',
          ),
          isPublic: false,
        };
      case StorageBucketAlias.ACHIEVEMENTS_BADGES:
        return {
          bucket: this.getRequiredEnv('R2_BUCKET_ACHIEVEMENTS_BADGES'),
          publicBaseUrl: this.getRequiredEnv(
            'R2_PUBLIC_URL_ACHIEVEMENTS_BADGES',
          ),
          keyPrefix: this.getOptionalEnv(
            'R2_KEY_PREFIX_ACHIEVEMENTS_BADGES',
            'achievements/badges',
          ),
          isPublic: true,
        };
      case StorageBucketAlias.DATA_EXPORTS:
        return {
          bucket: this.getRequiredEnv('R2_BUCKET_DATA_EXPORTS'),
          publicBaseUrl: this.getRequiredEnv('R2_PUBLIC_URL_DATA_EXPORTS'),
          keyPrefix: this.getOptionalEnv(
            'R2_KEY_PREFIX_DATA_EXPORTS',
            'data-exports',
          ),
          isPublic: false,
        };
      case StorageBucketAlias.MATERIALES_COMPROBANTES:
        return {
          bucket: this.getRequiredEnv('R2_BUCKET_MATERIALES_COMPROBANTES'),
          publicBaseUrl: this.getRequiredEnv(
            'R2_PUBLIC_URL_MATERIALES_COMPROBANTES',
          ),
          keyPrefix: this.getOptionalEnv(
            'R2_KEY_PREFIX_MATERIALES_COMPROBANTES',
            'materiales/comprobantes',
          ),
          isPublic: false,
        };
      default:
        throw new AppInternalServerErrorException(
          ErrorCode.R2_VALIDATION_FAILED,
          undefined,
          { reason: 'unknown_bucket_alias', bucketAlias },
        );
    }
  }

  private getRequiredEnv(name: string) {
    const value = this.configService.get<string>(name)?.trim();
    if (!value) {
      this.logger.error(
        `R2 config error: required env var "${name}" is missing or empty`,
      );
      throw new AppInternalServerErrorException(
        ErrorCode.R2_VALIDATION_FAILED,
        undefined,
        { reason: 'missing_env', envVar: name },
      );
    }
    return value;
  }

  private getOptionalEnv(name: string, defaultValue = '') {
    const value = this.configService.get<string>(name);
    if (value === undefined || value === null) {
      return defaultValue;
    }
    return value.trim();
  }

  private normalizeBaseUrl(baseUrl: string) {
    return baseUrl.replace(/\/+$/, '');
  }

  private normalizeKey(key: string) {
    return key.trim().replace(/^\/+/, '');
  }

  private toObjectKey(prefix: string, relativeKey: string) {
    const normalizedPrefix = prefix.trim().replace(/^\/+|\/+$/g, '');
    const normalizedRelative = this.normalizeKey(relativeKey);
    if (!normalizedPrefix) return normalizedRelative;
    if (!normalizedRelative) return normalizedPrefix;
    return `${normalizedPrefix}/${normalizedRelative}`;
  }

  private normalizeUrl(rawUrl: string) {
    try {
      const parsed = new URL(rawUrl);
      return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
    } catch {
      return rawUrl.split('?')[0].split('#')[0].replace(/\/+$/, '');
    }
  }

  private resolveSignedUrlExpiration(expiresInSeconds?: number) {
    const fromArgs =
      typeof expiresInSeconds === 'number' ? Math.floor(expiresInSeconds) : NaN;
    if (Number.isFinite(fromArgs) && fromArgs > 0) {
      return fromArgs;
    }

    const fromEnv = Number(
      this.configService.get<string>('R2_SIGNED_URL_EXPIRES_SECONDS') ??
        R2FileStorageService.DEFAULT_SIGNED_URL_EXPIRATION_SECONDS,
    );

    if (!Number.isFinite(fromEnv) || fromEnv <= 0) {
      return R2FileStorageService.DEFAULT_SIGNED_URL_EXPIRATION_SECONDS;
    }

    return Math.floor(fromEnv);
  }

  private resolveObjectKey(
    bucketAlias: StorageBucketAlias,
    keyOrPublicUrl: string,
  ): string | null {
    const normalizedInput = keyOrPublicUrl.trim();
    if (!normalizedInput) return null;

    const fromConfiguredPublicUrl = this.extractKeyFromPublicUrl(
      bucketAlias,
      normalizedInput,
    );
    if (fromConfiguredPublicUrl) {
      return this.normalizeKey(fromConfiguredPublicUrl);
    }

    const config = this.getBucketConfig(bucketAlias);
    if (this.looksLikeUrl(normalizedInput)) {
      const parsedUrl = this.parseUrl(normalizedInput);
      if (!parsedUrl) return null;

      if (!this.isKnownR2UrlHost(parsedUrl, config.publicBaseUrl)) {
        return null;
      }

      const pathFromUrl = this.extractPathFromUrl(parsedUrl);
      if (!pathFromUrl) return null;

      const withoutBucketPrefix = pathFromUrl.startsWith(`${config.bucket}/`)
        ? pathFromUrl.slice(config.bucket.length + 1)
        : pathFromUrl;

      if (!withoutBucketPrefix) return null;

      if (this.hasKeyPrefix(config.keyPrefix, withoutBucketPrefix)) {
        return this.normalizeKey(withoutBucketPrefix);
      }

      const normalizedPrefix = config.keyPrefix
        .trim()
        .replace(/^\/+|\/+$/g, '');
      if (normalizedPrefix) {
        const nestedPrefixIndex = withoutBucketPrefix.indexOf(
          `${normalizedPrefix}/`,
        );
        if (nestedPrefixIndex >= 0) {
          return this.normalizeKey(
            withoutBucketPrefix.slice(nestedPrefixIndex),
          );
        }
      }

      return this.toObjectKey(config.keyPrefix, withoutBucketPrefix);
    }

    if (this.hasKeyPrefix(config.keyPrefix, normalizedInput)) {
      return this.normalizeKey(normalizedInput);
    }

    return this.toObjectKey(config.keyPrefix, normalizedInput);
  }

  private parseUrl(rawUrl: string): URL | null {
    try {
      return new URL(rawUrl);
    } catch {
      return null;
    }
  }

  private extractPathFromUrl(parsedUrl: URL): string | null {
    const normalizedPath = decodeURIComponent(parsedUrl.pathname).replace(
      /^\/+/,
      '',
    );
    return normalizedPath || null;
  }

  private isKnownR2UrlHost(parsedUrl: URL, configuredBaseUrl: string): boolean {
    const host = parsedUrl.hostname.toLowerCase();

    if (
      host.endsWith('.r2.cloudflarestorage.com') ||
      host.endsWith('.r2.dev')
    ) {
      return true;
    }

    try {
      const configuredHost = new URL(configuredBaseUrl).hostname.toLowerCase();
      return host === configuredHost;
    } catch {
      return false;
    }
  }

  private hasKeyPrefix(prefix: string, key: string): boolean {
    const normalizedPrefix = prefix.trim().replace(/^\/+|\/+$/g, '');
    const normalizedKey = this.normalizeKey(key);

    if (!normalizedPrefix) return true;
    return (
      normalizedKey === normalizedPrefix ||
      normalizedKey.startsWith(`${normalizedPrefix}/`)
    );
  }

  private toRelativeKey(prefix: string, objectKey: string): string {
    const normalizedPrefix = prefix.trim().replace(/^\/+|\/+$/g, '');
    const normalizedObjectKey = this.normalizeKey(objectKey);

    if (!normalizedPrefix) return normalizedObjectKey;
    if (normalizedObjectKey === normalizedPrefix) return '';
    if (normalizedObjectKey.startsWith(`${normalizedPrefix}/`)) {
      return normalizedObjectKey.slice(normalizedPrefix.length + 1);
    }

    return normalizedObjectKey;
  }

  private looksLikeUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
  }
}
