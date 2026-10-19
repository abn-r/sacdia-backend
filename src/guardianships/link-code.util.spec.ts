import {
  deriveLinkCodeKey,
  formatLinkCode,
  generateLinkCode,
  hashLinkCode,
  isWellFormedLinkCode,
  normalizeLinkCode,
} from './link-code.util';

describe('link-code.util', () => {
  const key = deriveLinkCodeKey('a'.repeat(32));

  describe('generateLinkCode', () => {
    it('produces 8 Crockford base32 characters', () => {
      for (let index = 0; index < 200; index += 1) {
        const code = generateLinkCode();
        expect(code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
        expect(isWellFormedLinkCode(code)).toBe(true);
      }
    });

    it('does not repeat across a sample (40 bits of entropy)', () => {
      const seen = new Set(
        Array.from({ length: 500 }, () => generateLinkCode()),
      );
      expect(seen.size).toBe(500);
    });
  });

  describe('formatLinkCode', () => {
    it('shows XXXX-XXXX', () => {
      expect(formatLinkCode('7KQ4M9TX')).toBe('7KQ4-M9TX');
    });
  });

  describe('normalizeLinkCode', () => {
    it.each(['7KQ4-M9TX', '7kq4 m9tx', '7KQ4M9TX', ' 7kq4-m9tx\n'])(
      'treats %j as the same code',
      (input) => {
        expect(normalizeLinkCode(input)).toBe('7KQ4M9TX');
      },
    );

    it('folds the look-alike letters (O -> 0, I and L -> 1)', () => {
      expect(normalizeLinkCode('OIL0-1l1o')).toBe('01101110');
    });

    it('leaves garbage recognizable as malformed', () => {
      expect(isWellFormedLinkCode(normalizeLinkCode('hello'))).toBe(false);
      expect(isWellFormedLinkCode(normalizeLinkCode('7KQ4-M9TXU'))).toBe(false);
      expect(isWellFormedLinkCode(normalizeLinkCode(''))).toBe(false);
    });
  });

  describe('hashLinkCode', () => {
    it('is a 64 char hex digest and never contains the plain code', () => {
      const hash = hashLinkCode('7KQ4M9TX', key);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash.toLowerCase()).not.toContain('7kq4m9tx');
    });

    it('is deterministic and keyed', () => {
      expect(hashLinkCode('7KQ4M9TX', key)).toBe(hashLinkCode('7KQ4M9TX', key));
      expect(hashLinkCode('7KQ4M9TX', key)).not.toBe(
        hashLinkCode('7KQ4M9TY', key),
      );
      expect(hashLinkCode('7KQ4M9TX', key)).not.toBe(
        hashLinkCode('7KQ4M9TX', deriveLinkCodeKey('b'.repeat(32))),
      );
    });

    it('hashes equivalent inputs to the same value once normalized', () => {
      expect(hashLinkCode(normalizeLinkCode('7kq4 m9tx'), key)).toBe(
        hashLinkCode(normalizeLinkCode('7KQ4-M9TX'), key),
      );
    });
  });

  describe('deriveLinkCodeKey', () => {
    it('is 32 bytes and differs from the raw secret', () => {
      const derived = deriveLinkCodeKey('a'.repeat(32));
      expect(derived).toHaveLength(32);
      expect(derived.equals(Buffer.from('a'.repeat(32)))).toBe(false);
    });
  });
});
