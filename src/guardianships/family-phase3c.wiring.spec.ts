import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AdminFamilyAccessService } from '../admin/admin-family-access.service';
import { AdminModule } from '../admin/admin.module';
import { AdminUsersController } from '../admin/admin-users.controller';
import { envValidationSchema } from '../config/env.validation';
import { DependentClaimCodesController } from './dependent-claim-codes.controller';
import { DirectorDependentsController } from './director-dependents.controller';
import { DirectorDependentsService } from './director-dependents.service';
import {
  FAMILY_AGE_TRANSITIONS_JOB,
  FamilyAgeTransitionsCronService,
} from './family-age-transitions-cron.service';
import { GuardianshipsModule } from './guardianships.module';
import { LinkedDevicesService } from './linked-devices.service';
import { PendingTeenCronService } from './pending-teen-cron.service';
import { SupervisedLoginsService } from './supervised-logins.service';

const metadata = (key: string, target: object): unknown[] =>
  Reflect.getMetadata(key, target) ?? [];

/**
 * Phase 3c wiring review (T3c-B19): every provider, cron and controller the
 * sub-phase added is registered where it runs. A class that is written but not
 * listed boots fine and then silently never runs (a cron) or answers 404 (a
 * controller), which is exactly what a unit test of the class cannot see. The
 * HTTP side is exercised by test/director-created-minor.e2e-spec.ts, which
 * boots the whole AppModule.
 */
describe('Family profiles phase 3c wiring', () => {
  describe('GuardianshipsModule', () => {
    const providers = metadata(MODULE_METADATA.PROVIDERS, GuardianshipsModule);
    const controllers = metadata(
      MODULE_METADATA.CONTROLLERS,
      GuardianshipsModule,
    );
    const exported = metadata(MODULE_METADATA.EXPORTS, GuardianshipsModule);

    it.each([
      [
        'the birthday-13 nudge + device sweep cron',
        FamilyAgeTransitionsCronService,
      ],
      ['the director-created minor service', DirectorDependentsService],
      ['the pending-teen cron (3a, kept)', PendingTeenCronService],
    ])('registers %s as a provider', (_label, provider) => {
      expect(providers).toContain(provider);
    });

    it.each([
      ['POST /club-sections/:id/dependents', DirectorDependentsController],
      [
        'POST .../dependents/:userId/claim-codes',
        DependentClaimCodesController,
      ],
    ])('registers the controller of %s', (_label, controller) => {
      expect(controllers).toContain(controller);
    });

    it('exports what the admin module needs to cut a minor access (and nothing is exported twice)', () => {
      expect(exported).toContain(SupervisedLoginsService);
      expect(exported).toContain(LinkedDevicesService);
      expect(new Set(exported).size).toBe(exported.length);
    });

    it('lists every provider once', () => {
      const classes = providers.filter(
        (provider): provider is new (...args: never[]) => unknown =>
          typeof provider === 'function',
      );
      expect(new Set(classes).size).toBe(classes.length);
    });
  });

  describe('AdminModule', () => {
    it('registers the admin family access service and keeps the users controller', () => {
      expect(metadata(MODULE_METADATA.PROVIDERS, AdminModule)).toContain(
        AdminFamilyAccessService,
      );
      expect(metadata(MODULE_METADATA.CONTROLLERS, AdminModule)).toContain(
        AdminUsersController,
      );
      expect(metadata(MODULE_METADATA.IMPORTS, AdminModule)).toContain(
        GuardianshipsModule,
      );
    });
  });

  describe('the nudge cron', () => {
    it('is scheduled once a day at 14:00 UTC with its own job name', () => {
      expect(FAMILY_AGE_TRANSITIONS_JOB).toBe('family-age-transitions');
      expect(
        Reflect.getMetadata(
          'SCHEDULE_CRON_OPTIONS',
          FamilyAgeTransitionsCronService.prototype.handleDaily,
        ),
      ).toMatchObject({
        cronTime: '0 14 * * *',
        name: FAMILY_AGE_TRANSITIONS_JOB,
        timeZone: 'UTC',
      });
    });

    it('does not collide with the other family crons (04:20 purge, 04:40 pending teens)', () => {
      const pending = Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        PendingTeenCronService.prototype.handleDaily,
      );
      const nudge = Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        FamilyAgeTransitionsCronService.prototype.handleDaily,
      );
      expect(pending.name).not.toBe(nudge.name);
      expect(pending.cronTime).not.toBe(nudge.cronTime);
    });
  });

  describe('the three feature flags', () => {
    const FLAGS = [
      'FAMILY_TEEN_LOGIN_ENABLED',
      'FAMILY_LINKED_DEVICE_ENABLED',
      'FAMILY_DIRECTOR_CREATE_MINOR_ENABLED',
    ] as const;

    it.each(FLAGS)('%s is validated at boot and defaults to false', (flag) => {
      const base = {
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
        DIRECT_URL: 'postgresql://u:p@localhost:5432/db',
        BETTER_AUTH_SECRET: 'x'.repeat(40),
        QR_JWT_SECRET: 'y'.repeat(40),
      };
      const described = envValidationSchema.describe();
      expect(described.keys[flag]).toMatchObject({
        type: 'boolean',
        flags: { default: false },
      });
      const { value } = envValidationSchema.validate(
        { ...base, [flag]: 'true' },
        { allowUnknown: true },
      );
      expect(value[flag]).toBe(true);
    });
  });
});
