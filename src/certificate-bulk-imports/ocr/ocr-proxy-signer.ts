import { createHash, createHmac } from 'node:crypto';
import {
  decodeOcrProxySecret,
  OCR_PROXY_SECRET_MIN_BYTES,
} from '../../config/ocr-proxy-secret';

const VERSION = 'v1';
const METHOD = 'POST';
const PATH = '/v1/ocr';

export const OCR_PROXY_HEADERS = {
  version: 'X-Ocr-Version',
  environment: 'X-Ocr-Env',
  kid: 'X-Ocr-Kid',
  operationId: 'X-Ocr-Operation-Id',
  issuedAt: 'X-Ocr-Issued-At',
  contentType: 'X-Ocr-Content-Type',
  contentLength: 'X-Ocr-Content-Length',
  pageCount: 'X-Ocr-Page-Count',
  timestamp: 'X-Ocr-Timestamp',
  nonce: 'X-Ocr-Nonce',
  contentSha256: 'X-Ocr-Content-SHA256',
  signature: 'X-Ocr-Signature',
} as const;

export type OcrProxySignedRequest = {
  signature: string;
  contentSha256: string;
  headers: Array<[string, string]>;
};

export function signOcrProxyRequest(input: {
  environment: string;
  kid: string;
  operationId: string;
  issuedAt: string;
  contentType: string;
  pageCount: number;
  timestamp: number;
  nonce: string;
  body: Uint8Array;
  /**
   * Prefer the Buffer from `decodeOcrProxySecret` (decoded once at startup).
   * Buffers are used as is: only the minimum length is re-checked, there is
   * no copy and no base64 decode per request. A string is decoded each call.
   */
  secret: Buffer | Uint8Array | string;
}): OcrProxySignedRequest {
  const secret = ocrProxySecretBytes(input.secret);
  const contentSha256 = createHash('sha256').update(input.body).digest('hex');
  const canonical = [
    VERSION,
    METHOD,
    PATH,
    input.environment,
    input.kid,
    input.operationId,
    input.issuedAt,
    input.contentType,
    String(input.body.byteLength),
    String(input.pageCount),
    String(input.timestamp),
    input.nonce,
    contentSha256,
  ].join('\n');
  const signature = createHmac('sha256', secret)
    .update(`${canonical}\n`)
    .digest('hex');
  return {
    signature,
    contentSha256,
    headers: [
      [OCR_PROXY_HEADERS.version, VERSION],
      [OCR_PROXY_HEADERS.environment, input.environment],
      [OCR_PROXY_HEADERS.kid, input.kid],
      [OCR_PROXY_HEADERS.operationId, input.operationId],
      [OCR_PROXY_HEADERS.issuedAt, input.issuedAt],
      [OCR_PROXY_HEADERS.contentType, input.contentType],
      [OCR_PROXY_HEADERS.contentLength, String(input.body.byteLength)],
      [OCR_PROXY_HEADERS.pageCount, String(input.pageCount)],
      [OCR_PROXY_HEADERS.timestamp, String(input.timestamp)],
      [OCR_PROXY_HEADERS.nonce, input.nonce],
      [OCR_PROXY_HEADERS.contentSha256, contentSha256],
      [OCR_PROXY_HEADERS.signature, signature],
    ],
  };
}

function ocrProxySecretBytes(secret: Buffer | Uint8Array | string): Buffer {
  const bytes =
    typeof secret === 'string'
      ? decodeOcrProxySecret(secret)
      : Buffer.isBuffer(secret)
        ? secret
        : Buffer.from(secret.buffer, secret.byteOffset, secret.byteLength);
  // Never include key material in the error.
  if (!bytes || bytes.byteLength < OCR_PROXY_SECRET_MIN_BYTES) {
    throw new Error('INVALID_CONTRACT');
  }
  return bytes;
}
