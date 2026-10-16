import { Controller, Get, Post } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '../../common/errors/error-codes';
import { ActingScope, ACTING_SCOPE_KEY } from './acting-scope.decorator';
import {
  assertActingScope,
  isActingScopeAllowed,
  readActingScope,
} from './acting-scope.policy';
import {
  ACTING_FOR_SCOPES,
  GUARDIAN_PENDING_SCOPES,
  GUARDIAN_VERIFIED_SCOPES,
  LINKED_DEVICE_SCOPES,
} from './auth-principal';

@Controller('probe')
@ActingScope('self:read')
class ClassScopedController {
  @Get('a')
  inheritsClassScope() {
    return 'a';
  }

  @Post('b')
  @ActingScope('profile:write')
  handlerWins() {
    return 'b';
  }
}

@Controller('probe-open')
class UnscopedController {
  @Get('c')
  noScope() {
    return 'c';
  }
}

const contextFor = (controller: new () => object, method: string) =>
  ({
    getHandler: () =>
      (controller.prototype as Record<string, () => unknown>)[method],
    getClass: () => controller,
  }) as any;

describe('acting scope metadata and policy', () => {
  const reflector = new Reflector();
  const acting = (scopes: readonly string[]) =>
    ({ kind: 'guardian_acting', scopes }) as any;

  it('exposes the 7 Phase 2 scopes and the narrower pending set', () => {
    expect(ACTING_FOR_SCOPES).toEqual([
      'self:read',
      'profile:write',
      'registration:write',
      'classes:write',
      'honors:write',
      'evidence:upload',
      'legal:accept',
    ]);
    expect(GUARDIAN_PENDING_SCOPES).toEqual([
      'self:read',
      'profile:write',
      'registration:write',
      'legal:accept',
    ]);
    expect(GUARDIAN_VERIFIED_SCOPES).toEqual(ACTING_FOR_SCOPES);
  });

  it('declares (but does not wire) the Phase 3 linked device scopes', () => {
    expect(LINKED_DEVICE_SCOPES).toEqual(['self:read', 'evidence:upload']);
  });

  it('stores the scope under ACTING_SCOPE_KEY', () => {
    expect(Reflect.getMetadata(ACTING_SCOPE_KEY, ClassScopedController)).toBe(
      'self:read',
    );
  });

  it('the handler scope wins over the class scope', () => {
    expect(
      readActingScope(
        reflector,
        contextFor(ClassScopedController, 'handlerWins'),
      ),
    ).toBe('profile:write');
    expect(
      readActingScope(
        reflector,
        contextFor(ClassScopedController, 'inheritsClassScope'),
      ),
    ).toBe('self:read');
  });

  it('a plain user is never restricted', () => {
    const context = contextFor(UnscopedController, 'noScope');
    expect(() =>
      assertActingScope(reflector, context, { kind: 'user', scopes: null }),
    ).not.toThrow();
    expect(() => assertActingScope(reflector, context, {})).not.toThrow();
    expect(() =>
      assertActingScope(reflector, context, undefined),
    ).not.toThrow();
  });

  it('denies an acting principal on a route with no scope', () => {
    const context = contextFor(UnscopedController, 'noScope');

    expect(() =>
      assertActingScope(reflector, context, acting(ACTING_FOR_SCOPES)),
    ).toThrow(
      expect.objectContaining({
        code: ErrorCode.ACTING_FOR_SCOPE_DENIED,
        status: 403,
      }),
    );
    expect(
      isActingScopeAllowed(reflector, context, acting(ACTING_FOR_SCOPES)),
    ).toBe(false);
  });

  it('denies a scope the principal does not hold and reports the required one', () => {
    const context = contextFor(ClassScopedController, 'handlerWins');

    try {
      assertActingScope(reflector, context, acting(['self:read']));
      throw new Error('expected a denial');
    } catch (error) {
      expect(error).toMatchObject({
        code: ErrorCode.ACTING_FOR_SCOPE_DENIED,
        status: 403,
      });
      expect((error as any).getResponse().details).toEqual({
        required_scope: 'profile:write',
      });
    }
  });

  it('allows a scope the principal holds', () => {
    const context = contextFor(ClassScopedController, 'handlerWins');

    expect(() =>
      assertActingScope(reflector, context, acting(['profile:write'])),
    ).not.toThrow();
  });
});
