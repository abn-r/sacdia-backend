import { MONTHLY_REPORT_PDF_TEMPLATE_VERSION } from '../src/monthly-reports/monthly-report-artifact.constants';
import {
  parseBackfillOptions,
  runBackfill,
  type BackfillDependencies,
  type BackfillReportCandidate,
} from './backfill-monthly-report-pdfs';

const REPORT_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];

function candidate(
  reportId: string,
  overrides: Partial<BackfillReportCandidate> = {},
): BackfillReportCandidate {
  return {
    monthly_report_id: reportId,
    status: 'generated',
    snapshot_data: { member_count: 12 },
    pdf_r2_key: null,
    pdf_size_bytes: null,
    pdf_sha256: null,
    pdf_generated_at: null,
    pdf_template_version: null,
    ...overrides,
  };
}

function createDependencies(
  batches: BackfillReportCandidate[][],
): BackfillDependencies & {
  findMany: jest.Mock;
  ensureCurrentArtifact: jest.Mock;
  logger: { info: jest.Mock; error: jest.Mock };
} {
  const findMany = jest.fn();
  for (const batch of batches) findMany.mockResolvedValueOnce(batch);
  const ensureCurrentArtifact = jest.fn().mockResolvedValue({
    reportId: REPORT_IDS[0],
    key: '2026/08/enrollment/report.pdf',
    sizeBytes: 42,
    sha256: 'a'.repeat(64),
    generatedAt: new Date('2026-08-05T00:00:00.000Z'),
    templateVersion: MONTHLY_REPORT_PDF_TEMPLATE_VERSION,
  });
  const logger = { info: jest.fn(), error: jest.fn() };
  return {
    prisma: { monthly_reports: { findMany } },
    artifacts: { ensureCurrentArtifact },
    logger,
    findMany,
    ensureCurrentArtifact,
  };
}

describe('monthly report PDF backfill', () => {
  it('requires explicit apply for writes and defaults to a safe dry-run', () => {
    expect(parseBackfillOptions([])).toEqual({
      apply: false,
      dryRun: true,
      batchSize: 25,
      limit: undefined,
      cursor: undefined,
    });
    expect(parseBackfillOptions(['--dry-run', '--batch-size', '10'])).toEqual({
      apply: false,
      dryRun: true,
      batchSize: 10,
      limit: undefined,
      cursor: undefined,
    });
    expect(parseBackfillOptions(['--apply', '--limit', '2'])).toEqual({
      apply: true,
      dryRun: false,
      batchSize: 25,
      limit: 2,
      cursor: undefined,
    });
    expect(() => parseBackfillOptions(['--apply', '--dry-run'])).toThrow(
      'BACKFILL_USAGE',
    );
  });

  it('selects only generated or submitted reports with missing or outdated metadata', async () => {
    const deps = createDependencies([[]]);

    await runBackfill(deps, { apply: false, dryRun: true, batchSize: 25 });

    expect(deps.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: ['generated', 'submitted'] },
        OR: [
          { pdf_r2_key: null },
          { pdf_template_version: null },
          {
            pdf_template_version: { not: MONTHLY_REPORT_PDF_TEMPLATE_VERSION },
          },
        ],
      },
      orderBy: { monthly_report_id: 'asc' },
      select: {
        monthly_report_id: true,
        status: true,
        snapshot_data: true,
        pdf_r2_key: true,
        pdf_size_bytes: true,
        pdf_sha256: true,
        pdf_generated_at: true,
        pdf_template_version: true,
      },
      take: 25,
    });
  });

  it('does not upload or update records during dry-run', async () => {
    const deps = createDependencies([[candidate(REPORT_IDS[0])]]);

    const result = await runBackfill(deps, {
      apply: false,
      dryRun: true,
      batchSize: 25,
    });

    expect(result).toMatchObject({
      selected: 1,
      processed: 0,
      generated: 0,
      failed: 0,
      skipped: 1,
    });
    expect(deps.ensureCurrentArtifact).not.toHaveBeenCalled();
  });

  it('caps total processed rows with limit and paginates by cursor', async () => {
    const deps = createDependencies([
      [candidate(REPORT_IDS[0]), candidate(REPORT_IDS[1])],
      [candidate(REPORT_IDS[2])],
    ]);

    const result = await runBackfill(deps, {
      apply: true,
      dryRun: false,
      batchSize: 2,
      limit: 2,
    });

    expect(result).toMatchObject({ selected: 2, processed: 2, generated: 2 });
    expect(deps.ensureCurrentArtifact).toHaveBeenCalledTimes(2);
    expect(deps.findMany).toHaveBeenCalledTimes(1);
    expect(deps.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 2 }),
    );
  });

  it('uses the last monthly_report_id as the cursor for the next batch', async () => {
    const deps = createDependencies([
      [candidate(REPORT_IDS[0]), candidate(REPORT_IDS[1])],
      [candidate(REPORT_IDS[2])],
    ]);

    await runBackfill(deps, { apply: true, dryRun: false, batchSize: 2 });

    expect(deps.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cursor: { monthly_report_id: REPORT_IDS[1] },
        skip: 1,
        take: 2,
      }),
    );
    expect(deps.ensureCurrentArtifact).toHaveBeenCalledTimes(3);
  });

  it('continues after a failed record and logs only safe identifiers', async () => {
    const deps = createDependencies([
      [candidate(REPORT_IDS[0]), candidate(REPORT_IDS[1])],
    ]);
    deps.ensureCurrentArtifact
      .mockRejectedValueOnce(new Error('R2 unavailable'))
      .mockResolvedValueOnce({
        reportId: REPORT_IDS[1],
        key: '2026/08/enrollment/report.pdf',
        sizeBytes: 42,
        sha256: 'b'.repeat(64),
        generatedAt: new Date(),
        templateVersion: MONTHLY_REPORT_PDF_TEMPLATE_VERSION,
      });

    const result = await runBackfill(deps, {
      apply: true,
      dryRun: false,
      batchSize: 25,
    });

    expect(result).toMatchObject({
      selected: 2,
      processed: 2,
      generated: 1,
      failed: 1,
    });
    expect(deps.ensureCurrentArtifact).toHaveBeenCalledTimes(2);
    expect(deps.logger.error).toHaveBeenCalledWith(
      expect.stringContaining(REPORT_IDS[0]),
      expect.anything(),
    );
    expect(deps.logger.error.mock.calls[0].join(' ')).not.toContain('signed');
  });

  it('stops after the current record and returns the continuation cursor', async () => {
    const deps = createDependencies([
      [
        candidate(REPORT_IDS[0]),
        candidate(REPORT_IDS[1]),
        candidate(REPORT_IDS[2]),
      ],
    ]);
    let processed = 0;
    const shouldStop = () => processed >= 1;
    deps.ensureCurrentArtifact.mockImplementation(async () => {
      processed += 1;
      return {
        reportId: REPORT_IDS[0],
        key: '2026/08/enrollment/report.pdf',
        sizeBytes: 42,
        sha256: 'a'.repeat(64),
        generatedAt: new Date(),
        templateVersion: MONTHLY_REPORT_PDF_TEMPLATE_VERSION,
      };
    });

    const result = await runBackfill(deps, {
      apply: true,
      dryRun: false,
      batchSize: 25,
      shouldStop,
    });

    expect(result).toMatchObject({
      selected: 1,
      processed: 1,
      generated: 1,
      stopped: true,
      nextCursor: REPORT_IDS[0],
    });
    expect(deps.ensureCurrentArtifact).toHaveBeenCalledTimes(1);
  });
});
