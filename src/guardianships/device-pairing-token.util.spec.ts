import {
  DEVICE_PAIRING_TOKEN_KDF_INFO,
  deriveDevicePairingTokenKey,
  generatePairingToken,
  hashPairingToken,
  isWellFormedPairingToken,
  pairingQrPayload,
} from './device-pairing-token.util';
import { deriveLinkCodeKey } from './link-code.util';

const SECRET = 'test-secret-min-32-chars-for-hs256-hmac';

describe('device pairing token util', () => {
  it('generates 22 base64url characters (128 bits) that pass the shape check', () => {
    const token = generatePairingToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(isWellFormedPairingToken(token)).toBe(true);
    expect(Buffer.from(token, 'base64url')).toHaveLength(16);
  });

  it('does not repeat across many draws', () => {
    const seen = new Set(Array.from({ length: 2000 }, generatePairingToken));
    expect(seen.size).toBe(2000);
  });

  it.each([
    ['too short', 'abc'],
    ['too long', 'a'.repeat(23)],
    ['standard base64 characters', 'abcdefghijklmnopqrst+/'],
    ['padding', 'abcdefghijklmnopqrstu='],
    ['empty', ''],
    ['a number', 12345],
    ['null', null],
    ['an object', {}],
  ])('rejects a malformed token: %s', (_label, value) => {
    expect(isWellFormedPairingToken(value)).toBe(false);
  });

  it('hashes with HMAC-SHA256 to 64 hex chars, deterministically, and differently per token and per secret', () => {
    const key = deriveDevicePairingTokenKey(SECRET);
    const hash = hashPairingToken('abcdefghijklmnopqrstuv', key);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPairingToken('abcdefghijklmnopqrstuv', key)).toBe(hash);
    expect(hashPairingToken('abcdefghijklmnopqrstuw', key)).not.toBe(hash);
    expect(
      hashPairingToken(
        'abcdefghijklmnopqrstuv',
        deriveDevicePairingTokenKey('another-secret-min-32-chars-long-xx'),
      ),
    ).not.toBe(hash);
  });

  it('derives a key that is unrelated to the link-code key (distinct HKDF info)', () => {
    expect(DEVICE_PAIRING_TOKEN_KDF_INFO).toBe('sacdia:device-pairing-token');
    expect(
      deriveDevicePairingTokenKey(SECRET).equals(deriveLinkCodeKey(SECRET)),
    ).toBe(false);
    expect(deriveDevicePairingTokenKey(SECRET)).toHaveLength(32);
  });

  it('builds the deep link the app scans', () => {
    expect(pairingQrPayload('abcdefghijklmnopqrstuv')).toBe(
      'sacdia://pair?t=abcdefghijklmnopqrstuv',
    );
  });
});
