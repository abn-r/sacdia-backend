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
  AGE_UNKNOWN_SCOPES,
  GUARDIAN_PENDING_SCOPES,
  GUARDIAN_VERIFIED_SCOPES,
  DEVICE_SCOPES,
  TEEN_PENDING_SCOPES,
  TEEN_SCOPES,
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

  it('exposes the Phase 2 scopes plus the Phase 3 vocabulary', () => {
    expect([...ACTING_FOR_SCOPES].sort()).toEqual(
      [
        'self:read',
        'health:read',
        'profile:write',
        'registration:write',
        'classes:write',
        'evidence:submit',
        'honors:write',
        'evidence:upload',
        'legal:accept',
        'consent:evidence',
        'member:read',
        'member:write',
        'agenda:read',
        'push:register',
        'self:password',
        'self:preferences',
        'guardian_link:issue',
        'account:manage',
      ].sort(),
    );
  });

  it('keeps the guardian sets limited to the Phase 2 family scopes', () => {
    expect([...GUARDIAN_PENDING_SCOPES].sort()).toEqual(
      [
        'self:read',
        'health:read',
        'profile:write',
        'registration:write',
        'legal:accept',
        'consent:evidence',
      ].sort(),
    );
    expect([...GUARDIAN_VERIFIED_SCOPES].sort()).toEqual(
      [
        'self:read',
        'health:read',
        'profile:write',
        'registration:write',
        'classes:write',
        'evidence:submit',
        'honors:write',
        'evidence:upload',
        'legal:accept',
        'consent:evidence',
      ].sort(),
    );
    // The verified set is no longer an alias of the whole vocabulary.
    expect(GUARDIAN_VERIFIED_SCOPES).not.toEqual(ACTING_FOR_SCOPES);
    for (const teenOnly of [
      'member:read',
      'member:write',
      'agenda:read',
      'push:register',
      'self:password',
      'self:preferences',
      'guardian_link:issue',
    ]) {
      expect(GUARDIAN_VERIFIED_SCOPES).not.toContain(teenOnly);
      expect(GUARDIAN_PENDING_SCOPES).not.toContain(teenOnly);
    }
  });

  it('defines the teen sets', () => {
    expect([...TEEN_PENDING_SCOPES].sort()).toEqual(
      [
        'self:read',
        'health:read',
        'profile:write',
        'registration:write',
        'legal:accept',
        'guardian_link:issue',
        'self:password',
        'self:preferences',
        'push:register',
      ].sort(),
    );
    // Pending mode reaches no club data and no class/evidence/honors writes.
    for (const clubScope of [
      'member:read',
      'member:write',
      'agenda:read',
      'classes:write',
      'evidence:upload',
      'evidence:submit',
      'honors:write',
    ]) {
      expect(TEEN_PENDING_SCOPES).not.toContain(clubScope);
      expect(TEEN_SCOPES).toEqual(expect.arrayContaining([clubScope]));
    }
    // Teens never hold the guardian-only scopes.
    expect(TEEN_SCOPES).not.toContain('consent:evidence');
    expect(TEEN_SCOPES).not.toContain('guardian_link:issue');
    expect(TEEN_PENDING_SCOPES).not.toContain('consent:evidence');
  });

  it('defines the unknown-age set: onboarding, own profile, legal, push and own account only', () => {
    expect([...AGE_UNKNOWN_SCOPES].sort()).toEqual(
      [
        'self:read',
        'health:read',
        'profile:write',
        'registration:write',
        'legal:accept',
        'self:password',
        'push:register',
        'account:manage',
      ].sort(),
    );
    // No club data, no class/evidence/honors writes, no guardian or link powers.
    for (const forbidden of [
      'member:read',
      'member:write',
      'agenda:read',
      'classes:write',
      'evidence:upload',
      'evidence:submit',
      'honors:write',
      'consent:evidence',
      'guardian_link:issue',
      'self:preferences',
    ]) {
      expect(AGE_UNKNOWN_SCOPES).not.toContain(forbidden);
    }
    // Never wider than a pending teen, apart from managing the own account.
    for (const scope of AGE_UNKNOWN_SCOPES) {
      if (scope === 'account:manage') continue;
      expect(TEEN_PENDING_SCOPES).toContain(scope);
    }
  });

  it('account:manage belongs to the unknown-age set only (never a guardian, a teen or a device)', () => {
    for (const set of [
      GUARDIAN_PENDING_SCOPES,
      GUARDIAN_VERIFIED_SCOPES,
      TEEN_PENDING_SCOPES,
      TEEN_SCOPES,
      DEVICE_SCOPES,
    ] as ReadonlyArray<readonly string[]>) {
      expect(set).not.toContain('account:manage');
    }
  });

  it('defines the device scopes (no health, no classes:write, no password)', () => {
    expect([...DEVICE_SCOPES].sort()).toEqual(
      [
        'self:read',
        'evidence:upload',
        'evidence:submit',
        'push:register',
        'agenda:read',
      ].sort(),
    );
    for (const forbidden of [
      'health:read',
      'classes:write',
      'profile:write',
      'self:password',
      'legal:accept',
      'honors:write',
      'consent:evidence',
    ]) {
      expect(DEVICE_SCOPES).not.toContain(forbidden);
    }
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

  describe('supervised_user and linked_device', () => {
    const teen = (scopes: readonly string[], supervision?: string) =>
      ({ kind: 'supervised_user', scopes, supervision }) as any;
    const device = (scopes: readonly string[]) =>
      ({ kind: 'linked_device', scopes }) as any;

    it('denies a teen on an unscoped route with PRINCIPAL_SCOPE_DENIED (kind + supervision)', () => {
      const context = contextFor(UnscopedController, 'noScope');
      try {
        assertActingScope(
          reflector,
          context,
          teen(TEEN_PENDING_SCOPES, 'pending_guardian'),
        );
        throw new Error('expected a denial');
      } catch (error) {
        expect(error).toMatchObject({
          code: ErrorCode.PRINCIPAL_SCOPE_DENIED,
          status: 403,
        });
        expect((error as any).getResponse().details).toEqual({
          required_scope: null,
          kind: 'supervised_user',
          supervision: 'pending_guardian',
        });
      }
    });

    it('denies a teen on a scope it does not hold and reports the required one', () => {
      const context = contextFor(ClassScopedController, 'handlerWins');
      try {
        assertActingScope(reflector, context, teen(['self:read'], 'active'));
        throw new Error('expected a denial');
      } catch (error) {
        expect(error).toMatchObject({ code: ErrorCode.PRINCIPAL_SCOPE_DENIED });
        expect((error as any).getResponse().details).toEqual({
          required_scope: 'profile:write',
          kind: 'supervised_user',
          supervision: 'active',
        });
      }
    });

    it('denies a device with PRINCIPAL_SCOPE_DENIED and no supervision key', () => {
      const context = contextFor(UnscopedController, 'noScope');
      try {
        assertActingScope(reflector, context, device(DEVICE_SCOPES));
        throw new Error('expected a denial');
      } catch (error) {
        expect(error).toMatchObject({ code: ErrorCode.PRINCIPAL_SCOPE_DENIED });
        expect((error as any).getResponse().details).toEqual({
          required_scope: null,
          kind: 'linked_device',
        });
      }
    });

    it('allows a teen / device on a scope it holds', () => {
      const context = contextFor(ClassScopedController, 'handlerWins');
      expect(() =>
        assertActingScope(reflector, context, teen(TEEN_SCOPES, 'active')),
      ).not.toThrow();
      expect(
        isActingScopeAllowed(reflector, context, device(DEVICE_SCOPES)),
      ).toBe(false);
    });

    it('keeps guardian_acting on ACTING_FOR_SCOPE_DENIED (the app acting exit depends on it)', () => {
      const context = contextFor(UnscopedController, 'noScope');
      expect(() =>
        assertActingScope(reflector, context, acting(GUARDIAN_VERIFIED_SCOPES)),
      ).toThrow(
        expect.objectContaining({ code: ErrorCode.ACTING_FOR_SCOPE_DENIED }),
      );
    });
  });
  describe('age_unknown_user', () => {
    const newcomer = {
      kind: 'age_unknown_user',
      scopes: AGE_UNKNOWN_SCOPES,
    } as any;

    it('is denied on an unscoped route with PRINCIPAL_SCOPE_DENIED (kind, no supervision key)', () => {
      const context = contextFor(UnscopedController, 'noScope');
      try {
        assertActingScope(reflector, context, newcomer);
        throw new Error('expected a denial');
      } catch (error) {
        expect(error).toMatchObject({
          code: ErrorCode.PRINCIPAL_SCOPE_DENIED,
          status: 403,
        });
        expect((error as any).getResponse().details).toEqual({
          required_scope: null,
          kind: 'age_unknown_user',
        });
      }
    });

    it('reaches a route whose scope it holds', () => {
      const context = contextFor(ClassScopedController, 'handlerWins');
      expect(() =>
        assertActingScope(reflector, context, newcomer),
      ).not.toThrow();
    });
  });
});
