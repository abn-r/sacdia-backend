import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import 'multer';
import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { fileBufferMatchesDeclaredMime } from '../common/pipes/file-validation.pipe';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import type { FileStorageService } from '../common/services/file-storage.service';

export const HONOR_ASSET_KINDS = ['image', 'material'] as const;
export type HonorAssetKind = (typeof HONOR_ASSET_KINDS)[number];

type AssetRule = {
  bucket: StorageBucketAlias;
  maxBytes: number;
  extByMime: Record<string, string>;
};

/**
 * Honor image: PNG, JPEG or WebP up to 5 MB (SVG is never accepted: it can
 * carry script and the bucket is public). Material: PDF up to 10 MB, the
 * multipart cap of the endpoint.
 */
export const HONOR_ASSET_RULES: Record<HonorAssetKind, AssetRule> = {
  image: {
    bucket: StorageBucketAlias.HONORS_IMAGES,
    maxBytes: 5 * 1024 * 1024,
    extByMime: {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
    },
  },
  material: {
    bucket: StorageBucketAlias.HONORS_PDF,
    maxBytes: 10 * 1024 * 1024,
    extByMime: { 'application/pdf': 'pdf' },
  },
};

/**
 * Uploads the image or the material PDF of an honor to its public bucket and
 * returns the public URL, which the admin form then saves in `honor_image` or
 * `material_url`. Upload and save are separate steps because the honor does
 * not exist yet when it is being created.
 */
@Injectable()
export class HonorAssetsService {
  constructor(
    @Inject(FILE_STORAGE_SERVICE)
    private readonly fileStorage: FileStorageService,
  ) {}

  async upload(
    kind: HonorAssetKind,
    file: Express.Multer.File | undefined,
  ): Promise<{ kind: HonorAssetKind; url: string; key: string }> {
    if (!file?.buffer || file.size === 0) {
      throw new AppBadRequestException(ErrorCode.HONOR_ASSET_FILE_REQUIRED);
    }
    const rule = HONOR_ASSET_RULES[kind];
    const ext = rule.extByMime[file.mimetype];
    if (!ext || !fileBufferMatchesDeclaredMime(file)) {
      throw new AppBadRequestException(ErrorCode.FILE_TYPE_INVALID);
    }
    if (file.size > rule.maxBytes) {
      throw new AppBadRequestException(ErrorCode.HONOR_FILE_TOO_LARGE, {
        max_mb: rule.maxBytes / (1024 * 1024),
      });
    }

    // Relative to the bucket: the storage adds the bucket's key prefix.
    const key = `admin-uploads/${randomUUID()}.${ext}`;
    const { url } = await this.fileStorage.upload(
      rule.bucket,
      key,
      file.buffer,
      {
        contentType: file.mimetype,
      },
    );
    return { kind, url, key };
  }
}
