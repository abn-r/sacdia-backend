export const OCR_PROXY_SECRET_MIN_BYTES = 32;

/**
 * `OCR_PROXY_SECRET` is standard base64 of the raw HMAC key, as produced by
 * `openssl rand -base64 32`. The decoded key must be at least 32 bytes.
 * Returns null when the text is not canonical base64 or the key is shorter.
 */
export function decodeOcrProxySecret(value: string): Buffer | null {
  const trimmed = value.trim();
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      trimmed,
    )
  ) {
    return null;
  }
  const decoded = Buffer.from(trimmed, 'base64');
  if (decoded.toString('base64') !== trimmed) return null;
  if (decoded.byteLength < OCR_PROXY_SECRET_MIN_BYTES) return null;
  return decoded;
}
