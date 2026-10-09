import {
  BadRequestException,
  Inject,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImageAnnotatorClient, protos } from '@google-cloud/vision';
import type { FileStorageService } from '../../common/services/file-storage.service';
import { FILE_STORAGE_SERVICE } from '../../common/services/file-storage.service';
import {
  assertCertificateImportPdf,
  PDF_OCR_QUEUE_WAIT_MS,
} from '../certificate-import-pdf';
import {
  CertificateOcrFileInput,
  CertificateOcrProvider,
} from './certificate-ocr.provider';
import {
  CertificateOcrParseResult,
  CertificateOcrParser,
} from './certificate-ocr.parser';
import {
  clipStoredOcrText,
  readSealedCertificateObject,
} from './sealed-certificate-object';

const CALL_OPTIONS = { timeout: 25_000, retry: { retryCodes: [] as number[] } };
type VisionClient = Pick<
  ImageAnnotatorClient,
  'batchAnnotateImages' | 'batchAnnotateFiles' | 'close'
> & { auth: Pick<ImageAnnotatorClient['auth'], 'getClient'> };
type VisionClientOptions = ConstructorParameters<
  typeof ImageAnnotatorClient
>[0];
export type GoogleVisionClientFactory = (
  options: VisionClientOptions,
) => VisionClient;
export const GOOGLE_VISION_CLIENT_FACTORY = Symbol(
  'GOOGLE_VISION_CLIENT_FACTORY',
);
export const googleVisionClientFactoryProvider = {
  provide: GOOGLE_VISION_CLIENT_FACTORY,
  useValue: (options: VisionClientOptions) => new ImageAnnotatorClient(options),
};
type VisionError = {
  code?: number | string | null;
  status?: string | null;
  message?: string | null;
};
type PageResponse = protos.google.cloud.vision.v1.IAnnotateImageResponse;

@Injectable()
export class GoogleVisionCertificateOcrProvider
  implements CertificateOcrProvider, OnModuleDestroy
{
  private readonly parser = new CertificateOcrParser();
  private client?: VisionClient;
  private credentialsReady?: Promise<void>;

  constructor(
    @Inject(FILE_STORAGE_SERVICE) private readonly storage: FileStorageService,
    private readonly config: ConfigService,
    @Inject(GOOGLE_VISION_CLIENT_FACTORY)
    private readonly clientFactory: GoogleVisionClientFactory,
  ) {}

  async extract(
    files: CertificateOcrFileInput[],
  ): Promise<CertificateOcrParseResult> {
    const texts: string[] = [];
    for (const file of files) texts.push(await this.readFile(file));
    const rawText = texts.filter((text) => text.trim()).join('\n');
    if (!rawText.trim())
      throw new BadRequestException('CERTIFICATE_IMPORT_OCR_FAILED');
    const parsed = this.parser.parse(rawText);
    return { ...parsed, rawText: clipStoredOcrText(parsed.rawText) };
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.close();
  }

  private getClient(): VisionClient {
    if (!this.client) {
      try {
        this.client = this.clientFactory({
          fallback: false,
          projectId:
            this.config.get<string>('GOOGLE_CLOUD_PROJECT')?.trim() ||
            undefined,
          keyFilename:
            this.config.get<string>('GOOGLE_APPLICATION_CREDENTIALS')?.trim() ||
            undefined,
          'grpc.max_send_message_length': 12 * 1024 * 1024,
          'grpc.max_receive_message_length': 16 * 1024 * 1024,
        });
      } catch {
        throw new BadRequestException('CERTIFICATE_IMPORT_OCR_UNAVAILABLE');
      }
    }
    return this.client;
  }

  private async ensureCredentials(client: VisionClient): Promise<void> {
    try {
      // Separate ADC loading failures from Vision RPC errors.
      this.credentialsReady ??= client.auth.getClient().then(() => undefined);
      await this.credentialsReady;
    } catch {
      this.credentialsReady = undefined;
      throw new BadRequestException('CERTIFICATE_IMPORT_OCR_UNAVAILABLE');
    }
  }

  private async readFile(file: CertificateOcrFileInput): Promise<string> {
    const bytes = await readSealedCertificateObject(this.storage, file);
    const pageCount =
      file.fileType === 'application/pdf'
        ? await assertCertificateImportPdf(bytes, {
            queueWaitMs: PDF_OCR_QUEUE_WAIT_MS,
            queueFullCode: 'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
          })
        : undefined;
    try {
      const client = this.getClient();
      await this.ensureCredentials(client);
      if (pageCount != null)
        return await this.readPdf(client, bytes, pageCount);
      const [response] = await client.batchAnnotateImages(
        {
          requests: [
            {
              image: { content: bytes },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
              imageContext: { languageHints: ['es'] },
            },
          ],
        },
        CALL_OPTIONS,
      );
      if (response?.responses?.length !== 1)
        throw new BadRequestException('CERTIFICATE_IMPORT_OCR_FAILED');
      return this.pageText(response.responses[0]);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw this.vendorError(error);
    }
  }

  private async readPdf(
    client: VisionClient,
    bytes: Buffer,
    count: number,
  ): Promise<string> {
    const pages = Array.from({ length: count }, (_, n) => n + 1);
    const [response] = await client.batchAnnotateFiles(
      {
        requests: [
          {
            inputConfig: { content: bytes, mimeType: 'application/pdf' },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            imageContext: { languageHints: ['es'] },
            pages,
          },
        ],
      },
      CALL_OPTIONS,
    );
    if (response?.responses?.length !== 1)
      throw new BadRequestException('CERTIFICATE_IMPORT_OCR_FAILED');
    const file = response.responses[0];
    if (file.error?.code) throw this.vendorError(file.error);
    const responses = file.responses ?? [];
    // Check errors before completeness so quota/auth failures remain actionable.
    for (const page of responses)
      if (page.error?.code) throw this.vendorError(page.error);
    if (
      responses.length !== count ||
      (file.totalPages != null && file.totalPages !== count)
    )
      throw new BadRequestException('CERTIFICATE_IMPORT_OCR_FAILED');
    const byNumber = new Map<number, PageResponse>();
    for (const page of responses) {
      const number = page.context?.pageNumber;
      if (
        number == null ||
        !Number.isInteger(number) ||
        number < 1 ||
        number > count ||
        byNumber.has(number)
      )
        throw new BadRequestException('CERTIFICATE_IMPORT_OCR_FAILED');
      byNumber.set(number, page);
    }
    if (byNumber.size !== count)
      throw new BadRequestException('CERTIFICATE_IMPORT_OCR_FAILED');
    return pages
      .map((number) => this.pageText(byNumber.get(number)!))
      .join('\n');
  }

  private pageText(page: PageResponse): string {
    if (page.error?.code) throw this.vendorError(page.error);
    return typeof page.fullTextAnnotation?.text === 'string'
      ? page.fullTextAnnotation.text
      : '';
  }

  private vendorError(error: unknown): BadRequestException {
    const details = (
      error && typeof error === 'object' ? error : {}
    ) as VisionError;
    const code = details.code;
    if (
      code === 8 ||
      code === 429 ||
      code === 'RESOURCE_EXHAUSTED' ||
      details.status === 'RESOURCE_EXHAUSTED'
    )
      return new BadRequestException('CERTIFICATE_IMPORT_OCR_QUOTA');
    if (
      code === 7 ||
      code === 16 ||
      code === 401 ||
      code === 403 ||
      code === 'PERMISSION_DENIED' ||
      code === 'UNAUTHENTICATED' ||
      /could not load the default credentials|unable to detect a project id|no access, refresh token, api key or refresh handler callback/i.test(
        details.message ?? '',
      )
    )
      return new BadRequestException('CERTIFICATE_IMPORT_OCR_UNAVAILABLE');
    return new BadRequestException('CERTIFICATE_IMPORT_OCR_FAILED');
  }
}
