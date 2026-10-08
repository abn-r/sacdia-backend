import { randomBytes as nodeRandomBytes } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import { BadRequestException, Injectable } from '@nestjs/common';
import type { FileStorageService } from '../../common/services/file-storage.service';
import {
  assertCertificateImportPdf,
  PDF_OCR_QUEUE_WAIT_MS,
} from '../certificate-import-pdf';
import type {
  CertificateOcrFileInput,
  CertificateOcrProvider,
} from './certificate-ocr.provider';
import {
  CertificateOcrParseResult,
  CertificateOcrParser,
} from './certificate-ocr.parser';
import { signOcrProxyRequest } from './ocr-proxy-signer';
import {
  clipStoredOcrText,
  readSealedCertificateObject,
} from './sealed-certificate-object';

const RESPONSE_MAX_BYTES = 16_777_216;
const DEFAULT_TIMEOUT_MS = 40_000;
const FILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REQUEST_ID_PATTERN = /^[0-9a-f]{32}$/;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'INVALID_CONTRACT',
  'UNSUPPORTED_TYPE',
  'PAYLOAD_TOO_LARGE',
  'PDF_TOO_MANY_PAGES',
  'PDF_ENCRYPTED',
  'PDF_INVALID',
  'EMPTY_DOCUMENT',
  'RESPONSE_TOO_LARGE',
  'CONFLICT',
  'QUOTA',
  'UNAVAILABLE',
  'DISCONNECTED',
  'ENCODED',
  'UNCERTAIN',
  'PAGE_COUNT_MISMATCH',
] as const;
type OcrErrorCode = (typeof ERROR_CODES)[number];
const ERROR_CODE_SET = new Set<string>(ERROR_CODES);
const RENDER_CODE: Record<OcrErrorCode, string> = {
  UNAUTHORIZED: 'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
  FORBIDDEN: 'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
  INVALID_CONTRACT: 'CERTIFICATE_IMPORT_OCR_FAILED',
  UNSUPPORTED_TYPE: 'CERTIFICATE_IMPORT_OCR_UNSUPPORTED_TYPE',
  PAYLOAD_TOO_LARGE: 'CERTIFICATE_IMPORT_OCR_FILE_TOO_LARGE',
  PDF_TOO_MANY_PAGES: 'CERTIFICATE_IMPORT_PDF_TOO_MANY_PAGES',
  PDF_ENCRYPTED: 'CERTIFICATE_IMPORT_PDF_ENCRYPTED',
  PDF_INVALID: 'CERTIFICATE_IMPORT_PDF_INVALID',
  EMPTY_DOCUMENT: 'CERTIFICATE_IMPORT_OCR_FAILED',
  RESPONSE_TOO_LARGE: 'CERTIFICATE_IMPORT_OCR_FAILED',
  CONFLICT: 'CERTIFICATE_IMPORT_OCR_FAILED',
  QUOTA: 'CERTIFICATE_IMPORT_OCR_QUOTA',
  UNAVAILABLE: 'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
  DISCONNECTED: 'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
  ENCODED: 'CERTIFICATE_IMPORT_OCR_FAILED',
  UNCERTAIN: 'CERTIFICATE_IMPORT_OCR_FAILED',
  PAGE_COUNT_MISMATCH: 'CERTIFICATE_IMPORT_OCR_FAILED',
};

export type CloudRunCertificateOcrOptions = {
  url: string;
  environment: string;
  kid: string;
  /** Already decoded HMAC key (see `decodeOcrProxySecret`). */
  secret: Buffer;
  timeoutMs?: number;
  scheduleDeadline?: (ms: number, onFire: () => void) => { cancel: () => void };
  now?: () => Date;
  randomBytes?: (size: number) => Uint8Array;
  countPdf?: (bytes: Buffer) => Promise<number>;
};

type ProxyResponse = {
  status: number;
  body: Buffer;
  oversize: boolean;
};

@Injectable()
export class CloudRunCertificateOcrProvider implements CertificateOcrProvider {
  private readonly parser = new CertificateOcrParser();
  private readonly timeoutMs: number;
  private readonly scheduleDeadline: (
    ms: number,
    onFire: () => void,
  ) => { cancel: () => void };
  private readonly now: () => Date;
  private readonly randomBytes: (size: number) => Uint8Array;
  private readonly countPdf: (bytes: Buffer) => Promise<number>;

  constructor(
    private readonly storage: FileStorageService,
    private readonly options: CloudRunCertificateOcrOptions,
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.scheduleDeadline =
      options.scheduleDeadline ??
      ((ms, onFire) => {
        const timer = setTimeout(onFire, ms);
        timer.unref();
        return { cancel: () => clearTimeout(timer) };
      });
    this.now = options.now ?? (() => new Date());
    this.randomBytes = options.randomBytes ?? ((size) => nodeRandomBytes(size));
    this.countPdf =
      options.countPdf ??
      ((bytes) =>
        assertCertificateImportPdf(bytes, {
          queueWaitMs: PDF_OCR_QUEUE_WAIT_MS,
          queueFullCode: 'CERTIFICATE_IMPORT_OCR_UNAVAILABLE',
        }));
  }

  async extract(
    files: CertificateOcrFileInput[],
  ): Promise<CertificateOcrParseResult> {
    const texts: string[] = [];
    for (const file of files) texts.push(await this.readFile(file));
    const rawText = texts.filter((text) => text.trim()).join('\n');
    if (!rawText.trim()) this.fail('CERTIFICATE_IMPORT_OCR_FAILED');
    const parsed = this.parser.parse(rawText);
    return { ...parsed, rawText: clipStoredOcrText(parsed.rawText) };
  }

  private async readFile(file: CertificateOcrFileInput): Promise<string> {
    const operation = this.operation(file);
    const url = this.proxyUrl();
    const bytes = await readSealedCertificateObject(this.storage, file);
    const pageCount = await this.pageCount(file, bytes);
    const nonce = Buffer.from(this.randomBytes(16)).toString('hex');
    const timestamp = Math.floor(this.now().getTime() / 1000);
    const signed = signOcrProxyRequest({
      environment: this.options.environment,
      kid: this.options.kid,
      operationId: operation.operationId,
      issuedAt: operation.issuedAt,
      contentType: file.fileType,
      pageCount,
      timestamp,
      nonce,
      body: bytes,
      secret: this.options.secret,
    });
    const headers: Record<string, string> = {
      'content-type': 'application/octet-stream',
      'content-length': String(bytes.length),
    };
    for (const [name, value] of signed.headers) headers[name] = value;
    const response = await this.post(url, headers, bytes);
    return this.readText(response, operation.operationId, pageCount);
  }

  private operation(file: CertificateOcrFileInput): {
    operationId: string;
    issuedAt: string;
  } {
    if (!file.fileId || !FILE_ID_PATTERN.test(file.fileId)) {
      this.fail('CERTIFICATE_IMPORT_OCR_FAILED');
    }
    if (
      !(file.confirmedAt instanceof Date) ||
      Number.isNaN(file.confirmedAt.getTime())
    ) {
      this.fail('CERTIFICATE_IMPORT_OCR_FAILED');
    }
    return {
      operationId: file.fileId,
      issuedAt: file.confirmedAt.toISOString(),
    };
  }

  private proxyUrl(): URL {
    let url: URL;
    try {
      url = new URL(this.options.url);
    } catch {
      this.fail('CERTIFICATE_IMPORT_OCR_FAILED');
    }
    if (url.protocol === 'https:') return url;
    if (url.protocol === 'http:' && url.hostname === '127.0.0.1') return url;
    this.fail('CERTIFICATE_IMPORT_OCR_FAILED');
  }

  private async pageCount(
    file: CertificateOcrFileInput,
    bytes: Buffer,
  ): Promise<number> {
    if (file.fileType !== 'application/pdf') return 1;
    try {
      const count = await this.countPdf(bytes);
      if (!Number.isInteger(count) || count < 1 || count > 5) {
        this.fail('CERTIFICATE_IMPORT_OCR_FAILED');
      }
      return count;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.fail('CERTIFICATE_IMPORT_OCR_FAILED');
    }
  }

  private readText(
    response: ProxyResponse,
    operationId: string,
    pageCount: number,
  ): string {
    if (response.oversize) {
      this.fail(
        response.status === 429 || response.status >= 500
          ? 'CERTIFICATE_IMPORT_OCR_UNAVAILABLE'
          : 'CERTIFICATE_IMPORT_OCR_FAILED',
      );
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      this.fail('CERTIFICATE_IMPORT_OCR_UNAVAILABLE');
    }
    const envelope = this.errorEnvelope(response.body);
    if (envelope) this.fail(RENDER_CODE[envelope]);
    if (response.status === 200) {
      return this.successText(response.body, operationId, pageCount);
    }
    this.fail(
      response.status === 429 || response.status >= 500
        ? 'CERTIFICATE_IMPORT_OCR_UNAVAILABLE'
        : 'CERTIFICATE_IMPORT_OCR_FAILED',
    );
  }

  private errorEnvelope(body: Buffer): OcrErrorCode | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null;
    const record = parsed as Record<string, unknown>;
    if (record.version !== 'v1') return null;
    if (typeof record.code !== 'string' || !ERROR_CODE_SET.has(record.code)) {
      return null;
    }
    if (
      typeof record.requestId !== 'string' ||
      !REQUEST_ID_PATTERN.test(record.requestId)
    ) {
      return null;
    }
    return record.code as OcrErrorCode;
  }

  private successText(
    body: Buffer,
    operationId: string,
    pageCount: number,
  ): string {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      this.fail('CERTIFICATE_IMPORT_OCR_FAILED');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.fail('CERTIFICATE_IMPORT_OCR_FAILED');
    }
    const record = parsed as Record<string, unknown>;
    const pages = record.pages;
    if (
      record.version !== 'v1' ||
      record.operationId !== operationId ||
      record.pageCount !== pageCount ||
      !Array.isArray(pages) ||
      pages.length !== pageCount
    ) {
      this.fail('CERTIFICATE_IMPORT_OCR_FAILED');
    }
    const byNumber = new Map<number, string>();
    for (const page of pages) {
      if (!page || typeof page !== 'object')
        this.fail('CERTIFICATE_IMPORT_OCR_FAILED');
      const item = page as Record<string, unknown>;
      const pageNumber = item.pageNumber;
      if (
        typeof pageNumber !== 'number' ||
        !Number.isInteger(pageNumber) ||
        pageNumber < 1 ||
        pageNumber > pageCount ||
        byNumber.has(pageNumber) ||
        typeof item.text !== 'string'
      ) {
        this.fail('CERTIFICATE_IMPORT_OCR_FAILED');
      }
      byNumber.set(pageNumber, item.text);
    }
    if (byNumber.size !== pageCount) this.fail('CERTIFICATE_IMPORT_OCR_FAILED');
    return Array.from(
      { length: pageCount },
      (_, index) => byNumber.get(index + 1) ?? '',
    ).join('\n');
  }

  private post(
    url: URL,
    headers: Record<string, string>,
    body: Buffer,
  ): Promise<ProxyResponse> {
    const transport = url.protocol === 'https:' ? https.request : http.request;
    return new Promise((resolve, reject) => {
      let settled = false;
      let cancelDeadline: () => void = () => undefined;
      const finish = (value: ProxyResponse) => {
        if (settled) return;
        settled = true;
        cancelDeadline();
        resolve(value);
      };
      const giveUp = () => {
        if (settled) return;
        settled = true;
        cancelDeadline();
        reject(new BadRequestException('CERTIFICATE_IMPORT_OCR_UNAVAILABLE'));
      };
      const request = transport(
        url,
        {
          method: 'POST',
          headers,
          timeout: this.timeoutMs,
          rejectUnauthorized: true,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (REDIRECT_STATUSES.has(status)) {
            response.resume();
            giveUp();
            return;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          let oversize = false;
          response.on('data', (chunk: Buffer) => {
            if (oversize || settled) return;
            total += chunk.length;
            if (total > RESPONSE_MAX_BYTES) {
              oversize = true;
              chunks.length = 0;
              response.destroy();
              request.destroy();
              finish({ status, body: Buffer.alloc(0), oversize: true });
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            if (oversize) return;
            finish({
              status,
              body: Buffer.concat(chunks),
              oversize: false,
            });
          });
          response.on('error', () => giveUp());
        },
      );
      request.on('timeout', () => {
        request.destroy();
        giveUp();
      });
      request.on('error', () => giveUp());
      cancelDeadline = this.scheduleDeadline(this.timeoutMs, () => {
        request.destroy();
        giveUp();
      }).cancel;
      request.end(body);
    });
  }

  private fail(code: string): never {
    throw new BadRequestException(code);
  }
}
