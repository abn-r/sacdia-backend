import jwt from 'jsonwebtoken';
import {
  ACCESS_JWT_AUDIENCE,
  QR_MEMBER_AUDIENCE,
  accessJwtClaims,
} from '../common/constants/jwt-audiences';
import { isPresentedAccessJwtForUser } from './presented-access-jwt';

const SECRET = 'test-secret-min-32-chars-for-hs256';
const OTHER_SECRET = 'other-secret-min-32-chars-hs256!!';

function signAccess(
  overrides: Record<string, unknown> = {},
  secret = SECRET,
  signOptions: jwt.SignOptions = {},
): string {
  return jwt.sign(
    {
      sub: 'user-123',
      email: 'juan.garcia@example.com',
      ...accessJwtClaims(),
      ...overrides,
    },
    secret,
    { algorithm: 'HS256', expiresIn: '8h', ...signOptions },
  );
}

describe('isPresentedAccessJwtForUser', () => {
  it('accepts a current access JWT for the same user', () => {
    expect(
      isPresentedAccessJwtForUser(signAccess(), 'user-123', SECRET),
    ).toBe(true);
  });

  it('accepts an expired access JWT for the same user', () => {
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      {
        sub: 'user-123',
        email: 'juan.garcia@example.com',
        ...accessJwtClaims(),
        iat: now - 100,
        exp: now - 10,
      },
      SECRET,
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

  it('rejects a QR member audience', () => {
    const token = jwt.sign(
      {
        sub: 'user-123',
        email: 'juan.garcia@example.com',
        iss: 'https://api.sacdia.app',
        aud: QR_MEMBER_AUDIENCE,
      },
      SECRET,
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
    const token = jwt.sign(
      {
        sub: 'user-123',
        email: 'juan.garcia@example.com',
        iss: 'https://api.sacdia.app',
        aud: 'other-audience',
      },
      SECRET,
      { algorithm: 'HS256', expiresIn: '8h' },
    );

    expect(isPresentedAccessJwtForUser(token, 'user-123', SECRET)).toBe(false);
    expect(ACCESS_JWT_AUDIENCE).toBe('sacdia:access');
  });
});
