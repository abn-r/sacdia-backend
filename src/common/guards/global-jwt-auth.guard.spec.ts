import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { GlobalJwtAuthGuard } from './global-jwt-auth.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

function contextStub(): ExecutionContext {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue({ method: 'GET', url: '/test' }),
    }),
  } as unknown as ExecutionContext;
}

describe('GlobalJwtAuthGuard', () => {
  let reflector: Reflector;
  let superCanActivate: jest.SpyInstance;

  beforeEach(() => {
    reflector = new Reflector();
    // AuthGuard('jwt') resolves the passport strategy at request time; stub
    // the parent to isolate the @Public() bypass logic.
    superCanActivate = jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockReturnValue(true);
  });

  afterEach(() => {
    superCanActivate.mockRestore();
  });

  it('skips JWT auth entirely for routes marked @Public()', () => {
    const guard = new GlobalJwtAuthGuard(reflector);
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    expect(guard.canActivate(contextStub())).toBe(true);
    expect(superCanActivate).not.toHaveBeenCalled();
  });

  it('enforces JWT auth when the route is not public', () => {
    const guard = new GlobalJwtAuthGuard(reflector);
    const spy = jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(undefined);

    void guard.canActivate(contextStub());

    expect(spy).toHaveBeenCalledWith(IS_PUBLIC_KEY, expect.any(Array));
    expect(superCanActivate).toHaveBeenCalled();
  });

  it('route-level JwtAuthGuard ignores @Public() (no bypass inside public controllers)', () => {
    const guard = new JwtAuthGuard(reflector);
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);

    void guard.canActivate(contextStub());

    expect(superCanActivate).toHaveBeenCalled();
  });
});
