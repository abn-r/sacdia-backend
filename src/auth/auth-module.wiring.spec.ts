// Everything below runs before `../app.module` is required: an empty
// REDIS_URL keeps the container on the in-memory cache without BullMQ, no
// Firebase credentials keeps FCM on its no-op client, and the dummy secrets
// only satisfy env validation (no transport is ever used: the module is
// compiled, never initialised).
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = '';
delete process.env.FIREBASE_PROJECT_ID;
delete process.env.FIREBASE_PRIVATE_KEY;
delete process.env.FIREBASE_CLIENT_EMAIL;
process.env.DATABASE_URL ??=
  'postgresql://postgres:postgres@127.0.0.1:5432/wiring';
process.env.BETTER_AUTH_SECRET =
  process.env.BETTER_AUTH_SECRET && process.env.BETTER_AUTH_SECRET.length >= 32
    ? process.env.BETTER_AUTH_SECRET
    : 'wiring-better-auth-secret-32chars!!';
process.env.QR_JWT_SECRET =
  process.env.QR_JWT_SECRET &&
  process.env.QR_JWT_SECRET.length >= 32 &&
  process.env.QR_JWT_SECRET !== process.env.BETTER_AUTH_SECRET
    ? process.env.QR_JWT_SECRET
    : 'wiring-qr-jwt-secret-32-chars-xxxx';
process.env.EMAIL_ENABLED ??= 'false';
process.env.RESEND_API_KEY ??= 're_test_dummy_key';
process.env.RESEND_FROM_EMAIL ??= 'SACDIA <test@test.local>';
for (const bucket of [
  'HONORS_PDF',
  'EVIDENCE_FILES',
  'INSURANCE_EVIDENCE',
  'DATA_EXPORTS',
  'MONTHLY_REPORTS',
  'RESOURCES_FILES',
]) {
  process.env[`R2_BUCKET_${bucket}`] ??= 'test';
  process.env[`R2_PUBLIC_URL_${bucket}`] ??= 'https://r2.test';
}

import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';

/**
 * RBAC phase 7 follow-up: `AuthorizationContextService` must be ONE instance
 * for the whole container, the one CommonModule (global) provides. AuthModule
 * used to declare its own; inside AuthModule nothing resolves
 * NotificationsService, so that copy kept the `@Optional()` dependency
 * undefined and never emitted the per-user `authorization` invalidation push
 * (AuthService.setActiveAssignment and every module importing AuthModule used
 * that copy). The real AppModule is compiled (not initialised) on an inert
 * PrismaService double, so no database, Redis or Firebase is needed.
 */
describe('AuthorizationContextService wiring (single instance)', () => {
  describe('AuthModule metadata', () => {
    it('neither provides nor exports AuthorizationContextService (CommonModule owns it)', () => {
      const providers: unknown[] =
        Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AuthModule) ?? [];
      const exported: unknown[] =
        Reflect.getMetadata(MODULE_METADATA.EXPORTS, AuthModule) ?? [];
      expect(providers).not.toContain(AuthorizationContextService);
      expect(exported).not.toContain(AuthorizationContextService);
    });
  });

  describe('compiled AppModule', () => {
    let moduleRef: TestingModule;

    beforeAll(async () => {
      const prismaDouble = new Proxy(
        {},
        {
          get: (_target, prop: string | symbol) =>
            typeof prop === 'symbol' || prop === 'then'
              ? undefined
              : jest.fn().mockResolvedValue(null),
        },
      );
      moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(prismaDouble)
        .compile();
    }, 120_000);

    afterAll(async () => {
      await moduleRef?.close();
    });

    const authorizationContextOf = (consumer: object) =>
      (consumer as { authorizationContext: AuthorizationContextService })
        .authorizationContext;

    it('AuthService and RbacService receive the very same AuthorizationContextService', () => {
      const shared = moduleRef.get(AuthorizationContextService, {
        strict: false,
      });
      const authService = moduleRef.get(AuthService, { strict: false });
      const rbacService = moduleRef.get(RbacService, { strict: false });

      expect(shared).toBeInstanceOf(AuthorizationContextService);
      expect(authorizationContextOf(authService)).toBe(shared);
      expect(authorizationContextOf(rbacService)).toBe(shared);
    });

    it('that instance has NotificationsService resolved, so the authorization push can be emitted', () => {
      const shared = moduleRef.get(AuthorizationContextService, {
        strict: false,
      });
      const notifications = moduleRef.get(NotificationsService, {
        strict: false,
      });
      const injected = (
        shared as unknown as { notifications?: NotificationsService }
      ).notifications;

      expect(injected).toBeDefined();
      expect(injected).toBeInstanceOf(NotificationsService);
      expect(injected).toBe(notifications);
      // And the back edge of the forwardRef pair resolves to the same instance.
      expect(
        (
          notifications as unknown as {
            authorizationContext: AuthorizationContextService;
          }
        ).authorizationContext,
      ).toBe(shared);
    });
  });
});
