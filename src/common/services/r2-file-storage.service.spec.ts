/**
 * r2-file-storage.service.spec.ts
 *
 * Unit tests for R2FileStorageService.
 * Focus: regression coverage for Bug #1 — buildPublicUrl must include the
 * keyPrefix in the returned URL for prefixed buckets (USER_PROFILES, HONORS_*).
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { R2FileStorageService } from './r2-file-storage.service';
import { StorageBucketAlias } from './file-storage.service';

// ---------------------------------------------------------------------------
// AWS SDK mock — intercept S3Client at the class level
// ---------------------------------------------------------------------------

const mockS3Send = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual(
    '@aws-sdk/client-s3',
  ) as typeof import('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({
      send: mockS3Send,
    })),
  };
});

// ---------------------------------------------------------------------------
// Config factory
// ---------------------------------------------------------------------------

function makeConfigService(
  overrides: Record<string, string> = {},
): ConfigService {
  const defaults: Record<string, string> = {
    R2_ACCOUNT_ID: 'test-account',
    R2_ACCESS_KEY_ID: 'test-key',
    R2_SECRET_ACCESS_KEY: 'test-secret',
    R2_REGION: 'auto',

    // USER_PROFILES — prefixed bucket
    R2_BUCKET_USER_PROFILES: 'sacdia-users',
    R2_PUBLIC_URL_USER_PROFILES: 'https://pub-xxx.r2.dev',
    R2_KEY_PREFIX_USER_PROFILES: 'user-profiles',

    // HONORS_IMAGES — prefixed bucket
    R2_BUCKET_HONORS_IMAGES: 'sacdia-honors',
    R2_PUBLIC_URL_HONORS_IMAGES: 'https://pub-yyy.r2.dev',
    R2_KEY_PREFIX_HONORS_IMAGES: 'honors',

    // HONORS_PDF — prefixed bucket
    R2_BUCKET_HONORS_PDF: 'sacdia-honors-pdf',
    R2_PUBLIC_URL_HONORS_PDF: 'https://pub-zzz.r2.dev',
    R2_KEY_PREFIX_HONORS_PDF: 'honors_pdf',

    // ACHIEVEMENTS_BADGES — unprefixed bucket (regression: must still work)
    R2_BUCKET_ACHIEVEMENTS_BADGES: 'sacdia-badges',
    R2_PUBLIC_URL_ACHIEVEMENTS_BADGES: 'https://pub-badges.r2.dev',
    R2_KEY_PREFIX_ACHIEVEMENTS_BADGES: '',

    // Stubs for remaining required env vars
    R2_BUCKET_USERS_HONORS: 'sacdia-users-honors',
    R2_PUBLIC_URL_USERS_HONORS: 'https://priv.r2.dev',
    R2_BUCKET_USERS_HONORS_CERT: 'sacdia-users-honors-cert',
    R2_PUBLIC_URL_USERS_HONORS_CERT: 'https://priv.r2.dev',
    R2_BUCKET_CLASSES_DOCUMENTS: 'sacdia-classes',
    R2_PUBLIC_URL_CLASSES_DOCUMENTS: 'https://pub-classes.r2.dev',
    R2_BUCKET_ACTIVITIES_IMAGES: 'sacdia-activities',
    R2_PUBLIC_URL_ACTIVITIES_IMAGES: 'https://priv.r2.dev',
    R2_BUCKET_EVIDENCE_FILES: 'sacdia-evidence',
    R2_PUBLIC_URL_EVIDENCE_FILES: 'https://priv.r2.dev',
    R2_BUCKET_INSURANCE_EVIDENCE: 'sacdia-insurance',
    R2_PUBLIC_URL_INSURANCE_EVIDENCE: 'https://priv.r2.dev',
    R2_BUCKET_RESOURCES_FILES: 'sacdia-resources',
    R2_PUBLIC_URL_RESOURCES_FILES: 'https://priv.r2.dev',
    R2_BUCKET_DATA_EXPORTS: 'sacdia-exports',
    R2_PUBLIC_URL_DATA_EXPORTS: 'https://priv.r2.dev',
  };

  const env = { ...defaults, ...overrides };

  return {
    get: <T>(key: string): T | undefined => env[key] as unknown as T,
  } as unknown as ConfigService;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('R2FileStorageService', () => {
  let service: R2FileStorageService;

  async function buildService(
    overrides: Record<string, string> = {},
  ): Promise<R2FileStorageService> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        R2FileStorageService,
        { provide: ConfigService, useValue: makeConfigService(overrides) },
      ],
    }).compile();
    return module.get<R2FileStorageService>(R2FileStorageService);
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    service = await buildService();
  });

  // =========================================================================
  // upload — Bug #1 regression: URL must include keyPrefix
  // =========================================================================

  describe('upload — public URL must include keyPrefix (Bug #1 regression)', () => {
    const buffer = Buffer.from('fake-image');
    const imgOpts = { contentType: 'image/jpeg' };

    it('REGRESSION: USER_PROFILES upload URL contains /user-profiles/ prefix', async () => {
      // HeadObject → 404 (key does not exist, overwrite=false)
      // PutObject  → success
      mockS3Send
        .mockRejectedValueOnce({
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        })
        .mockResolvedValueOnce({});

      const result = await service.upload(
        StorageBucketAlias.USER_PROFILES,
        'photo-x.jpeg',
        buffer,
        imgOpts,
      );

      // The stored key must carry the prefix
      expect(result.key).toBe('user-profiles/photo-x.jpeg');

      // The URL must also carry the prefix — this was broken before the fix
      expect(result.url).toBe(
        'https://pub-xxx.r2.dev/user-profiles/photo-x.jpeg',
      );
      expect(result.url).toContain('/user-profiles/');
    });

    it('REGRESSION: HONORS_IMAGES upload URL contains /honors/ prefix', async () => {
      mockS3Send
        .mockRejectedValueOnce({
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        })
        .mockResolvedValueOnce({});

      const result = await service.upload(
        StorageBucketAlias.HONORS_IMAGES,
        'badge.png',
        buffer,
        imgOpts,
      );

      expect(result.key).toBe('honors/badge.png');
      expect(result.url).toBe('https://pub-yyy.r2.dev/honors/badge.png');
      expect(result.url).toContain('/honors/');
    });

    it('REGRESSION: HONORS_PDF upload URL contains /honors_pdf/ prefix', async () => {
      mockS3Send
        .mockRejectedValueOnce({
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        })
        .mockResolvedValueOnce({});

      const result = await service.upload(
        StorageBucketAlias.HONORS_PDF,
        'manual.pdf',
        buffer,
        { contentType: 'application/pdf' },
      );

      expect(result.key).toBe('honors_pdf/manual.pdf');
      expect(result.url).toBe('https://pub-zzz.r2.dev/honors_pdf/manual.pdf');
      expect(result.url).toContain('/honors_pdf/');
    });

    it('SAFE: ACHIEVEMENTS_BADGES (no prefix) still builds a correct URL', async () => {
      mockS3Send
        .mockRejectedValueOnce({
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        })
        .mockResolvedValueOnce({});

      const result = await service.upload(
        StorageBucketAlias.ACHIEVEMENTS_BADGES,
        'badge-fire.png',
        buffer,
        imgOpts,
      );

      expect(result.key).toBe('badge-fire.png');
      expect(result.url).toBe('https://pub-badges.r2.dev/badge-fire.png');
    });

    it('encodes special characters in the filename segment of the URL', async () => {
      mockS3Send
        .mockRejectedValueOnce({
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        })
        .mockResolvedValueOnce({});

      const result = await service.upload(
        StorageBucketAlias.USER_PROFILES,
        'photo name with spaces.jpeg',
        buffer,
        imgOpts,
      );

      expect(result.url).toContain('/user-profiles/');
      expect(result.url).toContain('photo%20name%20with%20spaces.jpeg');
    });

    it('overwrite=true skips HeadObject and still returns a prefixed URL', async () => {
      // Only one call expected (PutObject) — no HeadObject
      mockS3Send.mockResolvedValueOnce({});

      const result = await service.upload(
        StorageBucketAlias.USER_PROFILES,
        'photo-overwrite.jpeg',
        buffer,
        { contentType: 'image/jpeg', overwrite: true },
      );

      expect(mockS3Send).toHaveBeenCalledTimes(1);
      expect(mockS3Send).toHaveBeenCalledWith(expect.any(PutObjectCommand));
      expect(result.url).toBe(
        'https://pub-xxx.r2.dev/user-profiles/photo-overwrite.jpeg',
      );
    });
  });

  // =========================================================================
  // resolvePublicUrl — Bug #1 regression
  // =========================================================================

  describe('resolvePublicUrl — must include keyPrefix (Bug #1 regression)', () => {
    it('REGRESSION: bare filename gets prefix added', () => {
      const url = service.resolvePublicUrl(
        StorageBucketAlias.USER_PROFILES,
        'photo-bare.jpeg',
      );
      expect(url).toBe(
        'https://pub-xxx.r2.dev/user-profiles/photo-bare.jpeg',
      );
    });

    it('REGRESSION: full object key (already prefixed) is NOT double-prefixed', () => {
      // If the stored key already contains "user-profiles/" the URL must NOT
      // become .../user-profiles/user-profiles/photo-abc.jpeg
      const url = service.resolvePublicUrl(
        StorageBucketAlias.USER_PROFILES,
        'user-profiles/photo-abc.jpeg',
      );
      expect(url).toBe(
        'https://pub-xxx.r2.dev/user-profiles/photo-abc.jpeg',
      );
    });

    it('throws InternalServerErrorException on private bucket alias', () => {
      expect(() =>
        service.resolvePublicUrl(
          StorageBucketAlias.USERS_HONORS,
          'some-key.pdf',
        ),
      ).toThrow(InternalServerErrorException);
    });
  });

  // =========================================================================
  // upload — error propagation
  // =========================================================================

  describe('upload — error propagation', () => {
    it('throws InternalServerErrorException when PutObject fails', async () => {
      mockS3Send
        .mockRejectedValueOnce({
          name: 'NotFound',
          $metadata: { httpStatusCode: 404 },
        })
        .mockRejectedValueOnce(new Error('R2 network error'));

      await expect(
        service.upload(
          StorageBucketAlias.USER_PROFILES,
          'photo-fail.jpeg',
          Buffer.from('x'),
          { contentType: 'image/jpeg' },
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('throws InternalServerErrorException when key already exists (overwrite=false)', async () => {
      // HeadObject returns 200 → key exists → should throw
      mockS3Send.mockResolvedValueOnce({
        $metadata: { httpStatusCode: 200 },
      });

      await expect(
        service.upload(
          StorageBucketAlias.USER_PROFILES,
          'photo-existing.jpeg',
          Buffer.from('x'),
          { contentType: 'image/jpeg', overwrite: false },
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  // =========================================================================
  // extractKeyFromPublicUrl
  // =========================================================================

  describe('extractKeyFromPublicUrl', () => {
    it('extracts the full object key (with prefix) from a well-formed public URL', () => {
      // The URL contains "user-profiles/" in the path — key must include it
      const key = service.extractKeyFromPublicUrl(
        StorageBucketAlias.USER_PROFILES,
        'https://pub-xxx.r2.dev/user-profiles/photo-abc.jpeg',
      );
      expect(key).toBe('user-profiles/photo-abc.jpeg');
    });

    it('returns null for a URL from a different host', () => {
      const key = service.extractKeyFromPublicUrl(
        StorageBucketAlias.USER_PROFILES,
        'https://other-cdn.example.com/photo-abc.jpeg',
      );
      expect(key).toBeNull();
    });

    it('returns null for an empty string', () => {
      const key = service.extractKeyFromPublicUrl(
        StorageBucketAlias.USER_PROFILES,
        '',
      );
      expect(key).toBeNull();
    });
  });
});
