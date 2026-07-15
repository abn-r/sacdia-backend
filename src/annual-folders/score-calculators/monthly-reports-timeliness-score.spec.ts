import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { MonthlyReportsTimelinessScoreService } from './monthly-reports-timeliness-score';

describe('MonthlyReportsTimelinessScoreService.calc', () => {
  let svc: MonthlyReportsTimelinessScoreService;
  let prisma: {
    $queryRaw: jest.Mock;
    system_config: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn(),
      system_config: { findUnique: jest.fn() },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        MonthlyReportsTimelinessScoreService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = moduleRef.get(MonthlyReportsTimelinessScoreService);
  });

  const getLastQuery = () => {
    const [sqlParts, ...params] = prisma.$queryRaw.mock.calls.at(-1) as [
      TemplateStringsArray,
      ...unknown[],
    ];

    return {
      sql: Array.from(sqlParts).join(' '),
      params,
    };
  };

  it('returns captured_on_time / expected_months as percentage', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce({
      config_key: 'reports.auto_generate_day',
      config_value: '5',
    });
    prisma.$queryRaw.mockResolvedValueOnce([
      { captured_on_time: 9n, expected_months: 12n },
    ]);

    await expect(svc.calc('enrollment-id', 1)).resolves.toBe(75);
  });

  it('uses reports.auto_generate_day as the cutoff parameter', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce({
      config_key: 'reports.auto_generate_day',
      config_value: '28',
    });
    prisma.$queryRaw.mockResolvedValueOnce([
      { captured_on_time: 1n, expected_months: 1n },
    ]);

    await svc.calc('enrollment-id', 42);

    expect(prisma.system_config.findUnique).toHaveBeenCalledWith({
      where: { config_key: 'reports.auto_generate_day' },
    });
    expect(getLastQuery().params).toEqual([42, 28, 'enrollment-id']);
  });

  it('builds a strict next-month 23:00 UTC cutoff', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce({
      config_key: 'reports.auto_generate_day',
      config_value: '5',
    });
    prisma.$queryRaw.mockResolvedValueOnce([
      { captured_on_time: 1n, expected_months: 1n },
    ]);

    await svc.calc('enrollment-id', 42);

    const { sql, params } = getLastQuery();
    expect(sql).toContain(
      "EXTRACT(YEAR FROM (md.month_start + interval '1 month'))",
    );
    expect(sql).toContain(
      "EXTRACT(MONTH FROM (md.month_start + interval '1 month'))",
    );
    expect(sql).toMatch(/23,\s*0,\s*0,\s*'UTC'/);
    expect(sql).toMatch(/make_timestamptz\([\s\S]*\)\s+AS deadline_at/);
    expect(sql).toMatch(/mmd\.created_at\s+<\s+md\.deadline_at/);
    expect(sql).not.toContain('mmd.created_at <= md.deadline_at');
    expect(params).toEqual([42, 5, 'enrollment-id']);
  });

  it('excludes months whose deadline has not elapsed from both counts', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce({
      config_key: 'reports.auto_generate_day',
      config_value: '5',
    });
    prisma.$queryRaw.mockResolvedValueOnce([
      { captured_on_time: 0n, expected_months: 0n },
    ]);

    await expect(svc.calc('enrollment-id', 42)).resolves.toBe(0);

    const { sql, params } = getLastQuery();
    expect(sql).toMatch(
      /FROM month_deadlines md[\s\S]*WHERE md\.deadline_at\s*<=\s*CURRENT_TIMESTAMP/,
    );
    expect(sql).toMatch(/COUNT\(md\.month_start\)::bigint AS expected_months/);
    expect(sql).toMatch(
      /COUNT\(mmd\.manual_data_id\) FILTER[\s\S]*AS captured_on_time/,
    );
    expect(params).toEqual([42, 5, 'enrollment-id']);
  });

  it('does not credit manual data captured before the UTC reporting period', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce({
      config_key: 'reports.auto_generate_day',
      config_value: '5',
    });
    prisma.$queryRaw.mockResolvedValueOnce([
      { captured_on_time: 0n, expected_months: 1n },
    ]);

    await expect(svc.calc('enrollment-id', 42)).resolves.toBe(0);

    const { sql, params } = getLastQuery();
    expect(sql).toMatch(
      /make_timestamptz\(\s*EXTRACT\(YEAR FROM md\.month_start\)::int,\s*EXTRACT\(MONTH FROM md\.month_start\)::int,\s*1,\s*0,\s*0,\s*0,\s*'UTC'\s*\)\s+AS period_start_at/,
    );
    expect(sql).toMatch(/mmd\.created_at\s+>=\s+md\.period_start_at/);
    expect(params).toEqual([42, 5, 'enrollment-id']);
  });

  it('counts only reports whose unique manual data row was first captured before the cutoff', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce({
      config_key: 'reports.auto_generate_day',
      config_value: '5',
    });
    prisma.$queryRaw.mockResolvedValueOnce([
      { captured_on_time: 1n, expected_months: 1n },
    ]);

    await svc.calc('enrollment-id', 42);

    const { sql } = getLastQuery();
    expect(sql).toMatch(/LEFT JOIN monthly_report_manual_data mmd/);
    expect(sql).toMatch(/mmd\.monthly_report_id\s*=\s*mr\.monthly_report_id/);
    expect(sql).toMatch(
      /COUNT\(mmd\.manual_data_id\) FILTER[\s\S]*AS captured_on_time/,
    );
    expect(sql).not.toMatch(/mr\.status|mr\.submitted_at/);
    expect(sql).not.toMatch(/planning_meetings|parent_meetings|snapshot/i);
  });

  it('returns 0 when no monthly report has manual data captured on time', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce({
      config_key: 'reports.auto_generate_day',
      config_value: '5',
    });
    prisma.$queryRaw.mockResolvedValueOnce([
      { captured_on_time: 0n, expected_months: 12n },
    ]);

    await expect(svc.calc('enrollment-id', 1)).resolves.toBe(0);
  });

  it('returns 0 when the ecclesiastical year has no expected months', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce(null);
    prisma.$queryRaw.mockResolvedValueOnce([
      { captured_on_time: 0n, expected_months: 0n },
    ]);

    await expect(svc.calc('enrollment-id', 1)).resolves.toBe(0);
    expect(getLastQuery().params).toEqual([1, 5, 'enrollment-id']);
  });

  it('caps at 100 defensively', async () => {
    prisma.system_config.findUnique.mockResolvedValueOnce({
      config_key: 'reports.auto_generate_day',
      config_value: '5',
    });
    prisma.$queryRaw.mockResolvedValueOnce([
      { captured_on_time: 14n, expected_months: 12n },
    ]);

    await expect(svc.calc('enrollment-id', 1)).resolves.toBe(100);
  });

  it.each(['0', '29', '1.5', 'bad'])(
    'falls back to auto_generate_day=5 when system_config is invalid (%s)',
    async (configValue) => {
      prisma.system_config.findUnique.mockResolvedValueOnce({
        config_key: 'reports.auto_generate_day',
        config_value: configValue,
      });
      prisma.$queryRaw.mockResolvedValueOnce([
        { captured_on_time: 12n, expected_months: 12n },
      ]);

      await expect(svc.calc('enrollment-id', 1)).resolves.toBe(100);
      expect(prisma.system_config.findUnique).toHaveBeenCalledWith({
        where: { config_key: 'reports.auto_generate_day' },
      });
      expect(getLastQuery().params).toEqual([1, 5, 'enrollment-id']);
    },
  );
});
