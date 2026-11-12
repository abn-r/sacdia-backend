import { QuarterlyReportsCronService } from './quarterly-reports-cron.service';

function build(config: Record<string, string | undefined>) {
  const prisma: any = {
    system_config: {
      findUnique: jest.fn(async ({ where }: any) =>
        config[where.config_key] === undefined
          ? null
          : { config_value: config[where.config_key] },
      ),
    },
  };
  const reports: any = {
    freezeDueReports: jest
      .fn()
      .mockResolvedValue({ success: 3, skipped: 1, errors: 0 }),
  };
  const lock: any = {
    tryAcquire: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const logger: any = {
    track: jest.fn(async (_name: string, fn: () => Promise<unknown>) => fn()),
    trackSkipped: jest.fn(),
  };
  return {
    service: new QuarterlyReportsCronService(prisma, reports, lock, logger),
    reports,
    lock,
    logger,
  };
}

describe('QuarterlyReportsCronService', () => {
  it('runs daily at 03:00 UTC', () => {
    const cron = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      QuarterlyReportsCronService.prototype.handleAutoGenerate,
    );
    expect(cron).toMatchObject({
      name: 'quarterly-reports-auto-generate',
      cronTime: '0 3 * * *',
      timeZone: 'UTC',
    });
  });

  it('freezes due reports with the configured grace days', async () => {
    const { service, reports, lock } = build({
      'reports.quarterly_auto_generate_enabled': 'true',
      'reports.periodic_freeze_grace_days': '20',
    });

    await service.handleAutoGenerate();

    expect(reports.freezeDueReports).toHaveBeenCalledWith(20);
    expect(lock.release).toHaveBeenCalledWith(
      'cron:quarterly-reports-auto-generate',
    );
  });

  it('defaults the grace to 15 days when the key is missing or invalid', async () => {
    const missing = build({
      'reports.quarterly_auto_generate_enabled': 'true',
    });
    await missing.service.handleAutoGenerate();
    expect(missing.reports.freezeDueReports).toHaveBeenCalledWith(15);

    const invalid = build({
      'reports.quarterly_auto_generate_enabled': 'true',
      'reports.periodic_freeze_grace_days': 'soon',
    });
    await invalid.service.handleAutoGenerate();
    expect(invalid.reports.freezeDueReports).toHaveBeenCalledWith(15);
  });

  it('does nothing while the feature flag is not "true"', async () => {
    const { service, reports } = build({
      'reports.quarterly_auto_generate_enabled': 'false',
    });

    await service.handleAutoGenerate();

    expect(reports.freezeDueReports).not.toHaveBeenCalled();
  });

  it('skips (and records it) when another instance holds the lock', async () => {
    const { service, reports, lock, logger } = build({
      'reports.quarterly_auto_generate_enabled': 'true',
    });
    lock.tryAcquire.mockResolvedValue(false);

    await service.handleAutoGenerate();

    expect(reports.freezeDueReports).not.toHaveBeenCalled();
    expect(logger.trackSkipped).toHaveBeenCalledWith(
      'quarterly-reports-auto-generate',
      'lock_not_acquired',
    );
    expect(lock.release).not.toHaveBeenCalled();
  });

  it('releases the lock even when the run fails', async () => {
    const { service, reports, lock } = build({
      'reports.quarterly_auto_generate_enabled': 'true',
    });
    reports.freezeDueReports.mockRejectedValue(new Error('db down'));

    await expect(service.handleAutoGenerate()).resolves.toBeUndefined();

    expect(lock.release).toHaveBeenCalled();
  });
});
