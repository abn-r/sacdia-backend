import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { AppInternalServerErrorException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  FINANCE_EVIDENCE_MIME_TYPES,
  FinanceEvidenceMime,
  FinanceEvidenceObject,
  FinanceEvidenceObjectHead,
  FinanceEvidenceStoragePort,
} from './finance-evidence-storage.port';

const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
type IssueInput = Parameters<
  FinanceEvidenceStoragePort['issueCreateOnlyPut']
>[0];

@Injectable()
export class R2FinanceEvidenceStorageAdapter implements FinanceEvidenceStoragePort {
  private client: S3Client | null = null;

  constructor(private readonly config: ConfigService) {}

  async issueCreateOnlyPut(input: IssueInput) {
    this.assertIssueInput(input);
    const metadata = this.metadata(input, input.size);
    const requiredHeaders = Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [
        `x-amz-meta-${key}`,
        value,
      ]),
    );
    try {
      const uploadUrl = await getSignedUrl(
        this.getClient(),
        new PutObjectCommand({
          Bucket: this.bucket(),
          Key: this.key(input),
          IfNoneMatch: '*',
          ContentType: input.mimeType,
          ContentLength: input.size,
          Metadata: metadata,
        }),
        {
          expiresIn: input.expiresInSeconds,
          signableHeaders: new Set(['content-type']),
        },
      );
      return {
        uploadUrl,
        expiresInSeconds: input.expiresInSeconds,
        requiredHeaders: {
          'content-type': input.mimeType,
          'if-none-match': '*',
          ...requiredHeaders,
        },
      };
    } catch {
      throw this.failed();
    }
  }

  async head(
    input: FinanceEvidenceObject,
  ): Promise<FinanceEvidenceObjectHead | null> {
    this.assertObject(input);
    try {
      const result = await this.getClient().send(
        new HeadObjectCommand({ Bucket: this.bucket(), Key: this.key(input) }),
      );
      const mimeType = result.ContentType as FinanceEvidenceMime;
      const size = result.ContentLength;
      if (
        !result.ETag ||
        !FINANCE_EVIDENCE_MIME_TYPES.includes(mimeType) ||
        !this.isSize(size) ||
        !Object.entries(this.metadata(input, size)).every(
          ([key, value]) => result.Metadata?.[key] === value,
        )
      )
        throw this.failed();
      return {
        etag: result.ETag,
        size,
        mimeType,
        metadata: { ...input, size },
      };
    } catch (error) {
      if (this.isNotFound(error)) return null;
      if (error instanceof AppInternalServerErrorException) throw error;
      throw this.failed();
    }
  }

  async getStream(
    input: FinanceEvidenceObject & { etag: string },
  ): Promise<Readable> {
    this.assertObject(input);
    if (!input.etag.trim()) throw this.failed();
    try {
      const result = await this.getClient().send(
        new GetObjectCommand({
          Bucket: this.bucket(),
          Key: this.key(input),
          IfMatch: input.etag,
        }),
      );
      if (!result.Body || typeof (result.Body as Readable).pipe !== 'function')
        throw this.failed();
      return result.Body as Readable;
    } catch (error) {
      if (error instanceof AppInternalServerErrorException) throw error;
      throw this.failed();
    }
  }

  private key({ clubId, clubSectionId, uploadId }: FinanceEvidenceObject) {
    return `finance-ledger/${clubId}/${clubSectionId}/${uploadId}`;
  }
  private metadata(input: FinanceEvidenceObject, size: number) {
    return {
      'finance-upload-id': input.uploadId,
      'finance-club-id': String(input.clubId),
      'finance-club-section-id': String(input.clubSectionId),
      'finance-size': String(size),
    };
  }
  private isSize(value: unknown): value is number {
    return (
      typeof value === 'number' &&
      Number.isInteger(value) &&
      value > 0 &&
      value <= 5 * 1024 * 1024
    );
  }
  private assertObject(input: FinanceEvidenceObject) {
    if (
      'key' in input ||
      'uri' in input ||
      !UUID.test(input.uploadId) ||
      !Number.isInteger(input.clubId) ||
      input.clubId <= 0 ||
      !Number.isInteger(input.clubSectionId) ||
      input.clubSectionId <= 0
    )
      throw this.failed();
  }
  private assertIssueInput(input: IssueInput) {
    this.assertObject(input);
    if (
      !FINANCE_EVIDENCE_MIME_TYPES.includes(input.mimeType) ||
      !this.isSize(input.size) ||
      !Number.isInteger(input.expiresInSeconds) ||
      input.expiresInSeconds < 1 ||
      input.expiresInSeconds > 900
    )
      throw this.failed();
  }
  private bucket() {
    const value = this.config.get<string>('R2_BUCKET_EVIDENCE_FILES')?.trim();
    if (!value) throw this.failed();
    return value;
  }
  private getClient() {
    if (this.client) return this.client;
    const accountId = this.config.get<string>('R2_ACCOUNT_ID')?.trim();
    const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID')?.trim();
    const secretAccessKey = this.config
      .get<string>('R2_SECRET_ACCESS_KEY')
      ?.trim();
    if (!accountId || !accessKeyId || !secretAccessKey) throw this.failed();
    this.client = new S3Client({
      region: this.config.get<string>('R2_REGION') || 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
    return this.client;
  }
  private isNotFound(error: unknown) {
    const value = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };
    return (
      !!error &&
      typeof error === 'object' &&
      (value.name === 'NotFound' || value.$metadata?.httpStatusCode === 404)
    );
  }
  private failed() {
    return new AppInternalServerErrorException(ErrorCode.R2_VALIDATION_FAILED);
  }
}
