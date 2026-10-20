import { JwtService } from '@nestjs/jwt';
import {
  ACCESS_JWT_AUDIENCE,
  QR_MEMBER_AUDIENCE,
  accessJwtClaims,
  deviceJwtClaims,
} from '../common/constants/jwt-audiences';
import { isPresentedAccessJwtForUser } from './presented-access-jwt';

const SECRET = 'test-secret-min-32-chars-for-hs256';
const OTHER_SECRET = 'other-secret-min-32-chars-hs256!!';

function signAccess(
  overrides: Record<string, unknown> = {},
  secret = SECRET,
  signOptions: { expiresIn?: string | number } = {},
): string {
  return new JwtService({ secret }).sign(
    {
      sub: 'user-123',
      email: 'juan.garcia@example.com',
      ...accessJwtClaims(),
      ...overrides,
    },
    { algorithm: 'HS256', expiresIn: '8h', ...signOptions },
  );
}

describe('isPresentedAccessJwtForUser', () => {
  it('accepts a current access JWT for the same user', () => {
    expect(isPresentedAccessJwtForUser(signAccess(), 'user-123', SECRET)).toBe(
      true,
    );
  });

  it('accepts an expired access JWT for the same user', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = new JwtService({ secret: SECRET }).sign(
      {
        sub: 'user-123',
        email: 'juan.garcia@example.com',
        ...accessJwtClaims(),
        iat: now - 100,
        exp: now - 10,
      },
      { algorithm: 'HS256' },
    );

    expect(isPresentedAccessJwtForUser(token, 'user-123', SECRET)).toBe(true);
  });

  it('rejects an access JWT for another user', () => {
    expect(
      isPresentedAccessJwtForUser(signAccess(), 'other-user', SECRET),
    ).toBe(false);
  });

  it('rejects a token signed with another secret', () => {
    expect(
      isPresentedAccessJwtForUser(
        signAccess({}, OTHER_SECRET),
        'user-123',
        SECRET,
      ),
    ).toBe(false);
  });

  describe('a device JWT (aud sacdia:device, 3b)', () => {
    const signDevice = (
      overrides: Record<string, unknown> = {},
      secret = SECRET,
    ) =>
      new JwtService({ secret }).sign(
        {
          sub: 'child-1',
          sid: 'sid-1',
          dev: 'dev-1',
          ...deviceJwtClaims(),
          ...overrides,
        },
        { algorithm: 'HS256', expiresIn: '1h' },
      );

    it('is accepted for the same subject, so a device refresh blacklists the old device token', () => {
      expect(isPresentedAccessJwtForUser(signDevice(), 'child-1', SECRET)).toBe(
        true,
      );
    });

    it('an expired device JWT still counts (refresh happens after a 401)', () => {
      const now = Math.floor(Date.now() / 1000);
      const token = new JwtService({ secret: SECRET }).sign(
        {
          sub: 'child-1',
          ...deviceJwtClaims(),
          iat: now - 7200,
          exp: now - 3600,
        },
        { algorithm: 'HS256' },
      );
      expect(isPresentedAccessJwtForUser(token, 'child-1', SECRET)).toBe(true);
    });

    it('is rejected for another subject, another secret, another issuer', () => {
      expect(isPresentedAccessJwtForUser(signDevice(), 'other', SECRET)).toBe(
        false,
      );
      expect(
        isPresentedAccessJwtForUser(
          signDevice({}, OTHER_SECRET),
          'child-1',
          SECRET,
        ),
      ).toBe(false);
      expect(
        isPresentedAccessJwtForUser(
          signDevice({ iss: 'https://evil.example' }),
          'child-1',
          SECRET,
        ),
      ).toBe(false);
    });

    it('a device audience given as an array is not a device token', () => {
      expect(
        isPresentedAccessJwtForUser(
          signDevice({ aud: ['sacdia:device'] }),
          'child-1',
          SECRET,
        ),
      ).toBe(false);
    });
  });

  it('rejects a QR member audience', () => {
    const token = new JwtService({ secret: SECRET }).sign(
      {
        sub: 'user-123',
        email: 'juan.garcia@example.com',
        iss: 'https://api.sacdia.app',
        aud: QR_MEMBER_AUDIENCE,
      },
      { algorithm: 'HS256', expiresIn: '24h' },
    );

    expect(isPresentedAccessJwtForUser(token, 'user-123', SECRET)).toBe(false);
  });

  it('rejects garbage and empty inputs', () => {
    expect(isPresentedAccessJwtForUser('not-a-jwt', 'user-123', SECRET)).toBe(
      false,
    );
    expect(isPresentedAccessJwtForUser('', 'user-123', SECRET)).toBe(false);
    expect(isPresentedAccessJwtForUser(signAccess(), '', SECRET)).toBe(false);
  });

  it('rejects an access JWT whose aud is not sacdia:access', () => {
    const token = new JwtService({ secret: SECRET }).sign(
      {
        sub: 'user-123',
        email: 'juan.garcia@example.com',
        iss: 'https://api.sacdia.app',
        aud: 'other-audience',
      },
      { algorithm: 'HS256', expiresIn: '8h' },
    );

    expect(isPresentedAccessJwtForUser(token, 'user-123', SECRET)).toBe(false);
    expect(ACCESS_JWT_AUDIENCE).toBe('sacdia:access');
  });
});
