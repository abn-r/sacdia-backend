import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { AppInternalServerErrorException } from '../../common/errors/app.exception';
import { ConfigService } from '@nestjs/config';
import type { FileStorageService } from '../../common/services/file-storage.service';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../../common/services/file-storage.service';
import { CERTIFICATE_IMPORT_MAX_BYTES } from '../certificate-import-files.constants';
import {
  CertificateOcrFileInput,
  CertificateOcrProvider,
} from './certificate-ocr.provider';
import {
  CertificateOcrParseResult,
  CertificateOcrParser,
} from './certificate-ocr.parser';

const VISION_ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';
const STORED_TEXT_LIMIT = 20_000;
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

type VisionError = {
  code?: number;
  status?: string;
  message?: string;
};

type VisionResponse = {
  error?: VisionError;
  responses?: Array<{
    fullTextAnnotation?: { text?: string | null };
    error?: VisionError;
  }>;
};

@Injectable()
export class GoogleVisionCertificateOcrProvider implements CertificateOcrProvider {
  private readonly parser = new CertificateOcrParser();
  private fetchImpl: typeof fetch = fetch;

  constructor(
    @Inject(FILE_STORAGE_SERVICE)
    private readonly storage: FileStorageService,
    private readonly config: ConfigService,
  ) {}

  /** Tests swap the network call. Nest must not inject `fetch`. */
  setFetchForTests(fetchImpl: typeof fetch) {
    this.fetchImpl = fetchImpl;
  }

  async extract(
    files: CertificateOcrFileInput[],
  ): Promise<CertificateOcrParseResult> {
    const apiKey = this.config.get<string>('GOOGLE_VISION_API_KEY')?.trim();
    if (!apiKey) {
      throw new BadRequestException('CERTIFICATE_IMPORT_OCR_UNAVAILABLE');
    }

    const pages: string[] = [];
    for (const file of files) {
      pages.push(await this.readFile(file, apiKey));
    }

    const parsed = this.parser.parse(pages.filter(Boolean).join('\n'));
    return {
      ...parsed,
      rawText: parsed.rawText.slice(0, STORED_TEXT_LIMIT),
    };
  }

  private async readFile(
    file: CertificateOcrFileInput,
    apiKey: string,
  ): Promise<string> {
    if (!IMAGE_MIME_TYPES.has(file.fileType)) {
      throw new BadRequestException('CERTIFICATE_IMPORT_OCR_UNSUPPORTED_TYPE');
    }
    const objectKey = file.objectKey?.trim() ?? '';
    if (!objectKey || /^https?:\/\//i.test(objectKey)) {
      throw new BadRequestException('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
    }
    if ((file.sizeBytes ?? 0) > CERTIFICATE_IMPORT_MAX_BYTES) {
      throw new BadRequestException('CERTIFICATE_IMPORT_OCR_FILE_TOO_LARGE');
    }

    const info = await this.readStored(() =>
      this.storage.getObjectInfo(
        StorageBucketAlias.CERTIFICATE_IMPORTS,
        objectKey,
      ),
    );
    if (!info) {
      throw new BadRequestException('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
    }
    if (info.size > CERTIFICATE_IMPORT_MAX_BYTES) {
      throw new BadRequestException('CERTIFICATE_IMPORT_OCR_FILE_TOO_LARGE');
    }
    if (info.contentType && !IMAGE_MIME_TYPES.has(info.contentType)) {
      throw new BadRequestException('CERTIFICATE_IMPORT_OCR_UNSUPPORTED_TYPE');
    }

    const bytes = await this.readStored(() =>
      this.storage.getObject(
        StorageBucketAlias.CERTIFICATE_IMPORTS,
        objectKey,
        CERTIFICATE_IMPORT_MAX_BYTES,
      ),
    );
    if (!bytes) {
      throw new BadRequestException('CERTIFICATE_IMPORT_FILE_NOT_CONFIRMED');
    }

    return this.postImage(apiKey, bytes);
  }

  private async readStored<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AppInternalServerErrorException) {
        throw new BadRequestException('CERTIFICATE_IMPORT_STORAGE_UNAVAILABLE');
      }
      throw error;
    }
  }

  private async postImage(apiKey: string, bytes: Buffer): Promise<string> {
    let response: Response;
    try {
      response = await this.fetchImpl(VISION_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          requests: [
            {
              image: { content: bytes.toString('base64') },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
              imageContext: { languageHints: ['es'] },
            },
          ],
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(25_000),
      });
    } catch {
      throw new BadRequestException('CERTIFICATE_IMPORT_OCR_FAILED');
    }

    let payload: VisionResponse;
    try {
      payload = (await response.json()) as VisionResponse;
    } catch {
      throw new BadRequestException('CERTIFICATE_IMPORT_OCR_FAILED');
    }

    if (this.isQuota(response.status, payload)) {
      throw new BadRequestException('CERTIFICATE_IMPORT_OCR_QUOTA');
    }
    const page = payload.responses?.[0];
    if (!response.ok || payload.error || page?.error) {
      throw new BadRequestException('CERTIFICATE_IMPORT_OCR_FAILED');
    }

    return page?.fullTextAnnotation?.text ?? '';
  }

  private isQuota(status: number, payload: VisionResponse): boolean {
    if (status === 429) return true;
    const errors = [
      payload.error,
      ...(payload.responses ?? []).map((page) => page.error),
    ].filter((error): error is VisionError => !!error);
    return errors.some(
      (error) =>
        error.code === 8 ||
        error.code === 429 ||
        error.status === 'RESOURCE_EXHAUSTED' ||
        /quota|resource exhausted|rate limit/i.test(error.message ?? ''),
    );
  }
}
