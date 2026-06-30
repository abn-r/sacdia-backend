import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserAwareThrottlerGuard } from './user-aware-throttler.guard';

describe('UserAwareThrottlerGuard', () => {
  class TestableUserAwareThrottlerGuard extends UserAwareThrottlerGuard {
    public async getTrackerForTest(req: Record<string, any>): Promise<string> {
      return this.getTracker(req);
    }
  }

  const createConfigService = (secret?: string): ConfigService =>
    ({
      get: jest.fn(() => secret),
    }) as unknown as ConfigService;

  const createJwtService = (secret: string) =>
    new JwtService({ secret } as Record<string, string>);

  const createGuard = (
    secret: string,
    jwtService: JwtService = createJwtService(secret),
  ) =>
    new TestableUserAwareThrottlerGuard(
      {} as any,
      {} as any,
      {} as any,
      createConfigService(secret),
      jwtService,
    );

  const makeRequest = (options: {
    ip?: string;
    authorization?: string;
    user?: Record<string, any>;
  }): Record<string, any> => ({
    ip: options.ip ?? '198.51.100.20',
    headers: options.authorization ? { authorization: options.authorization } : {},
    socket: { remoteAddress: '198.51.100.21' },
    user: options.user,
  });

  const makeSignedToken = (secret: string, payload: { sub: string }) =>
    new JwtService({ secret } as Record<string, string>).sign(payload, {
      algorithm: 'HS256',
      expiresIn: '1h',
    });

  const makeUnsignedToken = (payload: { sub: string }) => {
    const header = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT' }),
      'utf8',
    ).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

    return `${header}.${body}.`;
  };

  it.each(['user_id', 'sub'])(
    'prefers req.user.%s before bearer token verification',
    async (userField) => {
      const guard = createGuard('valid-secret');
      const request = makeRequest({
        ip: '203.0.113.8',
        authorization: 'Bearer bad-token',
        user: { [userField]: 'from-req-user' } as any,
      });

      await expect(guard.getTrackerForTest(request)).resolves.toBe(
        'user:from-req-user',
      );
    },
  );

  it('uses user tracker when request has a valid signed bearer token', async () => {
    const secret = 'valid-secret';
    const token = makeSignedToken(secret, { sub: 'user-123' });
    const guard = createGuard(secret);

    const request = makeRequest({
      authorization: `Bearer ${token}`,
    });

    await expect(guard.getTrackerForTest(request)).resolves.toBe('user:user-123');
  });

  it.each([
    ['malformed bearer token', 'Bearer not-a-valid-jwt'],
    [
      'unsigned bearer token',
      `Bearer ${makeUnsignedToken({ sub: 'attacker' })}`,
    ],
    [
      'signed with wrong secret',
      `Bearer ${makeSignedToken('wrong-secret', { sub: 'attacker' })}`,
    ],
  ])('falls back to ip tracker for %s', async (_label, authorization) => {
    const secret = 'actual-secret';
    const guard = createGuard(secret);
    const request = makeRequest({
      ip: '203.0.113.99',
      authorization,
    });

    await expect(guard.getTrackerForTest(request)).resolves.toBe(
      'ip:203.0.113.99',
    );
  });

  it('uses ip tracker when request is anonymous', async () => {
    const guard = createGuard('valid-secret');
    const request = makeRequest({ ip: '203.0.113.45' });

    await expect(guard.getTrackerForTest(request)).resolves.toBe(
      'ip:203.0.113.45',
    );
  });

  it('falls back to ip tracker when BETTER_AUTH_SECRET is missing', async () => {
    const guard = new TestableUserAwareThrottlerGuard(
      {} as any,
      {} as any,
      {} as any,
      createConfigService(undefined),
      createJwtService('some-secret'),
    );

    const request = makeRequest({
      ip: '203.0.113.101',
      authorization: `Bearer ${makeSignedToken('some-secret', { sub: 'user-123' })}`,
    });

    await expect(guard.getTrackerForTest(request)).resolves.toBe(
      'ip:203.0.113.101',
    );
  });
});
