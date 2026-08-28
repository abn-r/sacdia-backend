import { timingSafeEqual } from 'node:crypto';

const MIN_SECRET_LENGTH = 32;

function secretsAreEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}

/**
 * QR member JWTs must not share BETTER_AUTH_SECRET. Same key + HS256
 * lets a photographed card authenticate as a full API session.
 */
export function resolveQrJwtSecret(config: {
  get(key: string): string | undefined;
}): string {
  const qrSecret = config.get('QR_JWT_SECRET')?.trim() ?? '';
  const accessSecret = config.get('BETTER_AUTH_SECRET')?.trim() ?? '';

  if (qrSecret.length < MIN_SECRET_LENGTH) {
    throw new Error('QR_JWT_SECRET must be at least 32 characters');
  }

  if (accessSecret.length < MIN_SECRET_LENGTH) {
    throw new Error('BETTER_AUTH_SECRET must be at least 32 characters');
  }

  if (secretsAreEqual(qrSecret, accessSecret)) {
    throw new Error('QR_JWT_SECRET must be distinct from BETTER_AUTH_SECRET');
  }

  return qrSecret;
}
