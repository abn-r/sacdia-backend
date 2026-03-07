"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var R2FileStorageService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.R2FileStorageService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const file_storage_service_1 = require("./file-storage.service");
let R2FileStorageService = class R2FileStorageService {
    static { R2FileStorageService_1 = this; }
    configService;
    logger = new common_1.Logger(R2FileStorageService_1.name);
    static DEFAULT_SIGNED_URL_EXPIRATION_SECONDS = 300;
    s3Client = null;
    constructor(configService) {
        this.configService = configService;
    }
    async upload(bucketAlias, key, buffer, options) {
        const config = this.getBucketConfig(bucketAlias);
        const normalizedKey = this.normalizeKey(key);
        const objectKey = this.toObjectKey(config.keyPrefix, normalizedKey);
        const overwrite = options.overwrite ?? false;
        if (!overwrite) {
            await this.assertKeyDoesNotExist(config.bucket, objectKey);
        }
        try {
            await this.getClient().send(new client_s3_1.PutObjectCommand({
                Bucket: config.bucket,
                Key: objectKey,
                Body: buffer,
                ContentType: options.contentType,
            }));
        }
        catch (error) {
            this.logger.error(`Error uploading object to R2 bucket=${config.bucket} key=${objectKey}`, error instanceof Error ? error.stack : String(error));
            throw new common_1.InternalServerErrorException('Error uploading file to R2');
        }
        return {
            key: objectKey,
            url: this.buildPublicUrl(config.publicBaseUrl, normalizedKey),
        };
    }
    async deleteMany(bucketAlias, keys) {
        const { bucket } = this.getBucketConfig(bucketAlias);
        const normalizedKeys = [
            ...new Set(keys.map((key) => this.normalizeKey(key))),
        ];
        if (normalizedKeys.length === 0)
            return;
        try {
            const response = await this.getClient().send(new client_s3_1.DeleteObjectsCommand({
                Bucket: bucket,
                Delete: {
                    Objects: normalizedKeys.map((key) => ({ Key: key })),
                    Quiet: true,
                },
            }));
            if (response.Errors && response.Errors.length > 0) {
                this.logger.error(`R2 partial delete failure in bucket=${bucket}: ${response.Errors.map((item) => `${item.Key || 'unknown'} (${item.Code || 'unknown'})`).join(', ')}`);
                throw new common_1.InternalServerErrorException('Error deleting files from R2');
            }
        }
        catch (error) {
            this.logger.error(`Error deleting objects from R2 bucket=${bucket}`, error instanceof Error ? error.stack : String(error));
            throw new common_1.InternalServerErrorException('Error deleting files from R2');
        }
    }
    extractKeyFromPublicUrl(bucketAlias, publicUrl) {
        if (!publicUrl)
            return null;
        const { publicBaseUrl, keyPrefix } = this.getBucketConfig(bucketAlias);
        const normalizedBase = this.normalizeBaseUrl(publicBaseUrl);
        const normalizedPublicUrl = this.normalizeUrl(publicUrl);
        const prefix = `${normalizedBase}/`;
        if (!normalizedPublicUrl.startsWith(prefix)) {
            return null;
        }
        const encodedRelativeKey = normalizedPublicUrl.slice(prefix.length);
        if (!encodedRelativeKey)
            return null;
        const relativeKey = decodeURIComponent(encodedRelativeKey);
        return this.toObjectKey(keyPrefix, relativeKey);
    }
    async getSignedDownloadUrl(bucketAlias, keyOrPublicUrl, options) {
        if (!keyOrPublicUrl?.trim()) {
            return keyOrPublicUrl;
        }
        const config = this.getBucketConfig(bucketAlias);
        const objectKey = this.resolveObjectKey(bucketAlias, keyOrPublicUrl);
        if (!objectKey) {
            return keyOrPublicUrl;
        }
        if (config.isPublic) {
            const relativeKey = this.toRelativeKey(config.keyPrefix, objectKey);
            return this.buildPublicUrl(config.publicBaseUrl, relativeKey);
        }
        const expiresIn = this.resolveSignedUrlExpiration(options?.expiresInSeconds);
        try {
            return await (0, s3_request_presigner_1.getSignedUrl)(this.getClient(), new client_s3_1.GetObjectCommand({
                Bucket: config.bucket,
                Key: objectKey,
            }), { expiresIn });
        }
        catch (error) {
            this.logger.error(`Error generating signed URL for R2 bucket=${config.bucket} key=${objectKey}`, error instanceof Error ? error.stack : String(error));
            throw new common_1.InternalServerErrorException('Error generating signed URL');
        }
    }
    buildPublicUrl(publicBaseUrl, relativeKey) {
        const normalizedBase = this.normalizeBaseUrl(publicBaseUrl);
        const normalizedKey = this.normalizeKey(relativeKey)
            .split('/')
            .map((segment) => encodeURIComponent(segment))
            .join('/');
        return `${normalizedBase}/${normalizedKey}`;
    }
    async assertKeyDoesNotExist(bucket, key) {
        try {
            await this.getClient().send(new client_s3_1.HeadObjectCommand({
                Bucket: bucket,
                Key: key,
            }));
            throw new common_1.InternalServerErrorException(`R2 object already exists: ${key}`);
        }
        catch (error) {
            if (error instanceof common_1.InternalServerErrorException ||
                this.isNotFoundError(error)) {
                if (this.isNotFoundError(error))
                    return;
                throw error;
            }
            this.logger.error(`Error checking object existence in R2 bucket=${bucket} key=${key}`, error instanceof Error ? error.stack : String(error));
            throw new common_1.InternalServerErrorException('Error validating R2 object key');
        }
    }
    isNotFoundError(error) {
        if (!error || typeof error !== 'object')
            return false;
        const maybeError = error;
        return (maybeError.name === 'NotFound' ||
            maybeError.$metadata?.httpStatusCode === 404);
    }
    getClient() {
        if (this.s3Client) {
            return this.s3Client;
        }
        const accountId = this.getRequiredEnv('R2_ACCOUNT_ID');
        const accessKeyId = this.getRequiredEnv('R2_ACCESS_KEY_ID');
        const secretAccessKey = this.getRequiredEnv('R2_SECRET_ACCESS_KEY');
        const region = this.configService.get('R2_REGION') || 'auto';
        this.s3Client = new client_s3_1.S3Client({
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
    getBucketConfig(bucketAlias) {
        switch (bucketAlias) {
            case file_storage_service_1.StorageBucketAlias.USER_PROFILES:
                return {
                    bucket: this.getRequiredEnv('R2_BUCKET_USER_PROFILES'),
                    publicBaseUrl: this.getRequiredEnv('R2_PUBLIC_URL_USER_PROFILES'),
                    keyPrefix: this.getOptionalEnv('R2_KEY_PREFIX_USER_PROFILES'),
                    isPublic: false,
                };
            case file_storage_service_1.StorageBucketAlias.HONORS_IMAGES:
                return {
                    bucket: this.getRequiredEnv('R2_BUCKET_HONORS_IMAGES'),
                    publicBaseUrl: this.getRequiredEnv('R2_PUBLIC_URL_HONORS_IMAGES'),
                    keyPrefix: this.getOptionalEnv('R2_KEY_PREFIX_HONORS_IMAGES'),
                    isPublic: true,
                };
            case file_storage_service_1.StorageBucketAlias.HONORS_PDF:
                return {
                    bucket: this.getRequiredEnv('R2_BUCKET_HONORS_PDF'),
                    publicBaseUrl: this.getRequiredEnv('R2_PUBLIC_URL_HONORS_PDF'),
                    keyPrefix: this.getOptionalEnv('R2_KEY_PREFIX_HONORS_PDF'),
                    isPublic: true,
                };
            case file_storage_service_1.StorageBucketAlias.USERS_HONORS:
                return {
                    bucket: this.getRequiredEnv('R2_BUCKET_USERS_HONORS'),
                    publicBaseUrl: this.getRequiredEnv('R2_PUBLIC_URL_USERS_HONORS'),
                    keyPrefix: this.getOptionalEnv('R2_KEY_PREFIX_USERS_HONORS'),
                    isPublic: false,
                };
            case file_storage_service_1.StorageBucketAlias.USERS_HONORS_CERT:
                return {
                    bucket: this.getRequiredEnv('R2_BUCKET_USERS_HONORS_CERT'),
                    publicBaseUrl: this.getRequiredEnv('R2_PUBLIC_URL_USERS_HONORS_CERT'),
                    keyPrefix: this.getOptionalEnv('R2_KEY_PREFIX_USERS_HONORS_CERT'),
                    isPublic: false,
                };
            case file_storage_service_1.StorageBucketAlias.CLASSES_DOCUMENTS:
                return {
                    bucket: this.getRequiredEnv('R2_BUCKET_CLASSES_DOCUMENTS'),
                    publicBaseUrl: this.getRequiredEnv('R2_PUBLIC_URL_CLASSES_DOCUMENTS'),
                    keyPrefix: this.getOptionalEnv('R2_KEY_PREFIX_CLASSES_DOCUMENTS'),
                    isPublic: true,
                };
            case file_storage_service_1.StorageBucketAlias.ACTIVITIES_IMAGES:
                return {
                    bucket: this.getRequiredEnv('R2_BUCKET_ACTIVITIES_IMAGES'),
                    publicBaseUrl: this.getRequiredEnv('R2_PUBLIC_URL_ACTIVITIES_IMAGES'),
                    keyPrefix: this.getOptionalEnv('R2_KEY_PREFIX_ACTIVITIES_IMAGES'),
                    isPublic: false,
                };
            default:
                throw new common_1.InternalServerErrorException(`Unsupported storage bucket alias: ${bucketAlias}`);
        }
    }
    getRequiredEnv(name) {
        const value = this.configService.get(name)?.trim();
        if (!value) {
            throw new common_1.InternalServerErrorException(`Missing required env var: ${name}`);
        }
        return value;
    }
    getOptionalEnv(name, defaultValue = '') {
        const value = this.configService.get(name);
        if (value === undefined || value === null) {
            return defaultValue;
        }
        return value.trim();
    }
    normalizeBaseUrl(baseUrl) {
        return baseUrl.replace(/\/+$/, '');
    }
    normalizeKey(key) {
        return key.trim().replace(/^\/+/, '');
    }
    toObjectKey(prefix, relativeKey) {
        const normalizedPrefix = prefix.trim().replace(/^\/+|\/+$/g, '');
        const normalizedRelative = this.normalizeKey(relativeKey);
        if (!normalizedPrefix)
            return normalizedRelative;
        if (!normalizedRelative)
            return normalizedPrefix;
        return `${normalizedPrefix}/${normalizedRelative}`;
    }
    normalizeUrl(rawUrl) {
        try {
            const parsed = new URL(rawUrl);
            return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
        }
        catch {
            return rawUrl.split('?')[0].split('#')[0].replace(/\/+$/, '');
        }
    }
    resolveSignedUrlExpiration(expiresInSeconds) {
        const fromArgs = typeof expiresInSeconds === 'number' ? Math.floor(expiresInSeconds) : NaN;
        if (Number.isFinite(fromArgs) && fromArgs > 0) {
            return fromArgs;
        }
        const fromEnv = Number(this.configService.get('R2_SIGNED_URL_EXPIRES_SECONDS') ??
            R2FileStorageService_1.DEFAULT_SIGNED_URL_EXPIRATION_SECONDS);
        if (!Number.isFinite(fromEnv) || fromEnv <= 0) {
            return R2FileStorageService_1.DEFAULT_SIGNED_URL_EXPIRATION_SECONDS;
        }
        return Math.floor(fromEnv);
    }
    resolveObjectKey(bucketAlias, keyOrPublicUrl) {
        const normalizedInput = keyOrPublicUrl.trim();
        if (!normalizedInput)
            return null;
        const fromConfiguredPublicUrl = this.extractKeyFromPublicUrl(bucketAlias, normalizedInput);
        if (fromConfiguredPublicUrl) {
            return this.normalizeKey(fromConfiguredPublicUrl);
        }
        const config = this.getBucketConfig(bucketAlias);
        if (this.looksLikeUrl(normalizedInput)) {
            const parsedUrl = this.parseUrl(normalizedInput);
            if (!parsedUrl)
                return null;
            if (!this.isKnownR2UrlHost(parsedUrl, config.publicBaseUrl)) {
                return null;
            }
            const pathFromUrl = this.extractPathFromUrl(parsedUrl);
            if (!pathFromUrl)
                return null;
            const withoutBucketPrefix = pathFromUrl.startsWith(`${config.bucket}/`)
                ? pathFromUrl.slice(config.bucket.length + 1)
                : pathFromUrl;
            if (!withoutBucketPrefix)
                return null;
            if (this.hasKeyPrefix(config.keyPrefix, withoutBucketPrefix)) {
                return this.normalizeKey(withoutBucketPrefix);
            }
            const normalizedPrefix = config.keyPrefix
                .trim()
                .replace(/^\/+|\/+$/g, '');
            if (normalizedPrefix) {
                const nestedPrefixIndex = withoutBucketPrefix.indexOf(`${normalizedPrefix}/`);
                if (nestedPrefixIndex >= 0) {
                    return this.normalizeKey(withoutBucketPrefix.slice(nestedPrefixIndex));
                }
            }
            return this.toObjectKey(config.keyPrefix, withoutBucketPrefix);
        }
        if (this.hasKeyPrefix(config.keyPrefix, normalizedInput)) {
            return this.normalizeKey(normalizedInput);
        }
        return this.toObjectKey(config.keyPrefix, normalizedInput);
    }
    parseUrl(rawUrl) {
        try {
            return new URL(rawUrl);
        }
        catch {
            return null;
        }
    }
    extractPathFromUrl(parsedUrl) {
        const normalizedPath = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
        return normalizedPath || null;
    }
    isKnownR2UrlHost(parsedUrl, configuredBaseUrl) {
        const host = parsedUrl.hostname.toLowerCase();
        if (host.endsWith('.r2.cloudflarestorage.com') ||
            host.endsWith('.r2.dev')) {
            return true;
        }
        try {
            const configuredHost = new URL(configuredBaseUrl).hostname.toLowerCase();
            return host === configuredHost;
        }
        catch {
            return false;
        }
    }
    hasKeyPrefix(prefix, key) {
        const normalizedPrefix = prefix.trim().replace(/^\/+|\/+$/g, '');
        const normalizedKey = this.normalizeKey(key);
        if (!normalizedPrefix)
            return true;
        return (normalizedKey === normalizedPrefix ||
            normalizedKey.startsWith(`${normalizedPrefix}/`));
    }
    toRelativeKey(prefix, objectKey) {
        const normalizedPrefix = prefix.trim().replace(/^\/+|\/+$/g, '');
        const normalizedObjectKey = this.normalizeKey(objectKey);
        if (!normalizedPrefix)
            return normalizedObjectKey;
        if (normalizedObjectKey === normalizedPrefix)
            return '';
        if (normalizedObjectKey.startsWith(`${normalizedPrefix}/`)) {
            return normalizedObjectKey.slice(normalizedPrefix.length + 1);
        }
        return normalizedObjectKey;
    }
    looksLikeUrl(value) {
        return /^https?:\/\//i.test(value);
    }
};
exports.R2FileStorageService = R2FileStorageService;
exports.R2FileStorageService = R2FileStorageService = R2FileStorageService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], R2FileStorageService);
//# sourceMappingURL=r2-file-storage.service.js.map