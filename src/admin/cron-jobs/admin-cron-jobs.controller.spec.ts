import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { DECORATORS } from '@nestjs/swagger';
import type { ExecutionContext } from '@nestjs/common';
import { ErrorCode } from '../../common/errors/error-codes';
import { GlobalRolesGuard } from '../../common/guards/global-roles.guard';
import type { AuthorizationContextService } from '../../common/services/authorization-context.service';
import { ACTING_SCOPE_KEY } from '../../auth/acting-for/acting-scope.decorator';
import { AdminCronJobsController } from './admin-cron-jobs.controller';
import type { AdminCronJobsService } from './admin-cron-jobs.service';

describe('AdminCronJobsController', () => {
  const service = { list: jest.fn(), run: jest.fn() };
  let controller: AdminCronJobsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AdminCronJobsController(
      service as unknown as AdminCronJobsService,
    );
  });

  it('GET lists the allowlist wrapped in the success envelope', () => {
    const jobs = [
      {
        job_name: 'activities-reminder',
        schedule: '*/15 * * * *',
        time_zone: 'UTC',
        runnable: true,
        description: 'x',
      },
    ];
    service.list.mockReturnValue(jobs);

    expect(controller.list()).toEqual({ status: 'success', data: { jobs } });
  });

  it('documents time_zone as nullable in the Swagger schema of GET', () => {
    const responses = Reflect.getMetadata(
      DECORATORS.API_RESPONSE,
      AdminCronJobsController.prototype.list,
    ) as {
      200: {
        schema: {
          properties: {
            data: {
              properties: {
                jobs: {
                  items: {
                    properties: {
                      time_zone: { type: string; nullable: boolean };
                    };
                  };
                };
              };
            };
          };
        };
      };
    };

    expect(
      responses[200].schema.properties.data.properties.jobs.items.properties
        .time_zone,
    ).toMatchObject({ type: 'string', nullable: true });
  });

  it('POST run executes the job as the caller and wraps the result', async () => {
    const data = {
      job_name: 'activities-reminder',
      run_id: 7,
      status: 'completed',
      items_processed: 2,
      duration_ms: 12,
      error_message: null,
      enqueued: false,
    };
    service.run.mockResolvedValue(data);

    const response = await controller.run('activities-reminder', {
      user: { sub: 'admin-1' },
    } as never);

    expect(service.run).toHaveBeenCalledWith('activities-reminder', 'admin-1');
    expect(response).toEqual({ status: 'success', data });
  });

  it('POST run propagates CRON_JOB_NOT_FOUND from the service', async () => {
    const error = { code: ErrorCode.CRON_JOB_NOT_FOUND };
    service.run.mockRejectedValue(error);

    await expect(
      controller.run('nope', { user: { sub: 'admin-1' } } as never),
    ).rejects.toBe(error);
  });

  describe('route metadata', () => {
    it('answers 200 (not 201) to the run POST', () => {
      expect(
        Reflect.getMetadata(
          HTTP_CODE_METADATA,
          AdminCronJobsController.prototype.run,
        ),
      ).toBe(200);
    });

    it('declares NO acting scope on any route (deny by default for guardian/teen/device)', () => {
      for (const handler of [
        AdminCronJobsController.prototype.list,
        AdminCronJobsController.prototype.run,
      ]) {
        expect(Reflect.getMetadata(ACTING_SCOPE_KEY, handler)).toBeUndefined();
      }
      expect(
        Reflect.getMetadata(ACTING_SCOPE_KEY, AdminCronJobsController),
      ).toBeUndefined();
    });

    it('throttles the run POST to 10 per minute', () => {
      const handler = AdminCronJobsController.prototype.run;
      for (const tier of ['short', 'medium', 'long']) {
        expect(Reflect.getMetadata(`THROTTLER:LIMIT${tier}`, handler)).toBe(10);
        expect(Reflect.getMetadata(`THROTTLER:TTL${tier}`, handler)).toBe(
          60000,
        );
      }
    });
  });

  describe('super-admin only', () => {
    const authorization = {
      isSuperAdmin: jest.fn(),
      hasAnyGlobalRole: jest.fn(),
    };
    const guard = new GlobalRolesGuard(
      new Reflector(),
      authorization as unknown as AuthorizationContextService,
    );
    const contextFor = (handler: (...args: never[]) => unknown) =>
      ({
        getHandler: () => handler,
        getClass: () => AdminCronJobsController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { sub: 'someone' } }),
        }),
      }) as unknown as ExecutionContext;

    it.each([
      ['list', AdminCronJobsController.prototype.list],
      ['run', AdminCronJobsController.prototype.run],
    ])(
      '%s denies a plain admin (403 GUARD_PERMISSION_DENIED)',
      async (_n, handler) => {
        authorization.isSuperAdmin.mockResolvedValue(false);
        authorization.hasAnyGlobalRole.mockResolvedValue(false);

        await expect(
          guard.canActivate(contextFor(handler as never)),
        ).rejects.toMatchObject({
          code: ErrorCode.GUARD_PERMISSION_DENIED,
          status: 403,
        });
        // Only super-admin is accepted: an `admin` role must not be offered.
        expect(authorization.hasAnyGlobalRole).toHaveBeenCalledWith('someone', [
          'super-admin',
        ]);
      },
    );

    it.each([
      ['list', AdminCronJobsController.prototype.list],
      ['run', AdminCronJobsController.prototype.run],
    ])('%s lets a super-admin through', async (_n, handler) => {
      authorization.isSuperAdmin.mockResolvedValue(true);

      await expect(
        guard.canActivate(contextFor(handler as never)),
      ).resolves.toBe(true);
    });
  });
});
