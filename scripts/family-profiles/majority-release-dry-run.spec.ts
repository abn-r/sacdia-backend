import { buildDryRunReport, parseDryRunArgs } from './majority-release-dry-run';

describe('majority-release-dry-run', () => {
  it('parses flags and validates --only', () => {
    expect(parseDryRunArgs([])).toEqual({
      list: false,
      allowProduction: false,
    });
    expect(
      parseDryRunArgs([
        '--list',
        '--only',
        'AAAAAAAA-0000-4000-8000-000000000001',
      ]),
    ).toEqual({
      list: true,
      allowProduction: false,
      only: 'aaaaaaaa-0000-4000-8000-000000000001',
    });
    expect(() => parseDryRunArgs(['--only', 'nope'])).toThrow('uuid');
    expect(() => parseDryRunArgs(['--bogus'])).toThrow('Unknown argument');
  });

  it('counts by step and country and splits the release source', () => {
    const report = buildDryRunReport([
      {
        user_id: 'a',
        step: 'release',
        majorityDate: '2026-01-01',
        source: 'catchup',
        country_id: 1,
      },
      {
        user_id: 'b',
        step: 'release',
        majorityDate: '2026-11-11',
        source: 'cron',
        country_id: 1,
      },
      {
        user_id: 'c',
        step: 'notice',
        majorityDate: '2026-12-01',
        country_id: null,
      },
      { user_id: 'd', step: 'freeze', majorityDate: null, country_id: 2 },
    ]);
    expect(report.total).toBe(4);
    expect(report.byStep).toEqual({
      notice: 1,
      release: 2,
      reminder: 0,
      freeze: 1,
    });
    expect(report.bySource).toEqual({ cron: 1, catchup: 1 });
    expect(report.byCountry['1']).toEqual({
      notice: 0,
      release: 2,
      reminder: 0,
      freeze: 0,
    });
    expect(report.byCountry['none'].notice).toBe(1);
    // uuid only: no personal data anywhere in the report
    expect(JSON.stringify(report)).not.toMatch(/@|name/);
  });
});
