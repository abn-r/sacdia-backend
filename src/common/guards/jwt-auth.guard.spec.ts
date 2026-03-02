import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const mockContext = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        url: '/api/v1/auth/me',
      }),
    }),
  } as any;

  it('should return user when authentication succeeds', () => {
    const guard = new JwtAuthGuard();
    const user = { user_id: 'user-123' };

    const result = guard.handleRequest(null, user, null, mockContext);

    expect(result).toEqual(user);
  });

  it('should throw UnauthorizedException when user is missing', () => {
    const guard = new JwtAuthGuard();

    expect(() =>
      guard.handleRequest(null, null, { message: 'No auth token' }, mockContext),
    ).toThrow(UnauthorizedException);
  });
});
