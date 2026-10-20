import 'reflect-metadata';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  OPTIONAL_DEPS_METADATA,
  SELF_DECLARED_DEPS_METADATA,
} from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { AuthService } from '../auth.service';
import { LoginFailureCounter } from '../login-failure-counter';
import { SocialSignInService } from '../social-sign-in/social-sign-in.service';
import { LinkCodesService } from '../../guardianships/link-codes.service';
import {
  NOOP_SUPERVISED_LOGIN_EVENTS,
  SUPERVISED_LOGIN_EVENTS,
} from './supervised-login-events.port';

/**
 * FP3-23 / verify W2: the security notices hang on ONE DI token. With
 * `@Optional()` a missing or broken binding silently became a no-op (no
 * guardian is ever told about a lock, a new session or a password change) and
 * nothing failed. The binding is REQUIRED now: an unbound token fails at boot.
 * The end-to-end delivery through the real GuardianSecurityNotificationsService
 * is proven on the real AppModule in test/supervised-login.e2e-spec.ts (G).
 */
describe('SUPERVISED_LOGIN_EVENTS binding is required (never a silent no-op)', () => {
  const consumers = [
    AuthService,
    LoginFailureCounter,
    SocialSignInService,
    LinkCodesService,
  ];

  it.each(consumers.map((consumer) => [consumer.name, consumer] as const))(
    '%s injects SUPERVISED_LOGIN_EVENTS without @Optional()',
    (_name, consumer) => {
      const declared: Array<{ index: number; param: unknown }> =
        Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, consumer) ?? [];
      const events = declared.find(
        (dep) => dep.param === SUPERVISED_LOGIN_EVENTS,
      );
      expect(events).toBeDefined();

      const optional: number[] =
        Reflect.getMetadata(OPTIONAL_DEPS_METADATA, consumer) ?? [];
      expect(optional).not.toContain(events!.index);
    },
  );

  it('a module that forgets the binding fails to compile (boot error, not a no-op)', async () => {
    await expect(
      Test.createTestingModule({
        providers: [
          LoginFailureCounter,
          { provide: CACHE_MANAGER, useValue: {} },
        ],
      }).compile(),
    ).rejects.toThrow(/SUPERVISED_LOGIN_EVENTS/);
  });

  it('an explicit no-op binding is the opt-out for tests that do not care about notices', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LoginFailureCounter,
        { provide: CACHE_MANAGER, useValue: {} },
        {
          provide: SUPERVISED_LOGIN_EVENTS,
          useValue: NOOP_SUPERVISED_LOGIN_EVENTS,
        },
      ],
    }).compile();
    expect(moduleRef.get(LoginFailureCounter)).toBeInstanceOf(
      LoginFailureCounter,
    );
  });
});
