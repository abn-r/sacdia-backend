import { MonthlyReportsService } from './monthly-reports.service';
import { ErrorCode } from '../common/errors/error-codes';

const REPORT_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT = {
  reportId: REPORT_ID,
  key: 'monthly-reports/2026/08/enrollment/report.pdf',
  sizeBytes: 42,
  sha256: 'a'.repeat(64),
  generatedAt: new Date('2026-08-06T12:00:00.000Z'),
  templateVersion: 'monthly-report-v2-three-page',
};
const ARTIFACT_METADATA = {
  pdf_r2_key: ARTIFACT.key,
  pdf_size_bytes: BigInt(ARTIFACT.sizeBytes),
  pdf_sha256: ARTIFACT.sha256,
  pdf_generated_at: ARTIFACT.generatedAt,
  pdf_template_version: ARTIFACT.templateVersion,
};

describe('MonthlyReportsService artifact-first generation', () => {
  const findUnique = jest.fn();
  const updateMany = jest.fn();
  const artifacts = {
    renderAndUpload: jest.fn(),
    getMetadataUpdate: jest.fn(),
    deleteArtifact: jest.fn(),
  };
  const lock = {
    tryAcquire: jest.fn(),
    release: jest.fn(),
  };
  const prisma = {
    monthly_reports: { findUnique, updateMany },
  };
  let service: MonthlyReportsService;

  const draft = {
    monthly_report_id: REPORT_ID,
    club_enrollment_id: 'enrollment-1',
    month: 8,
    year: 2026,
    status: 'draft',
    manual_data: { planning_meetings: 1 },
  };
  const generated = { ...draft, status: 'generated' };

  beforeEach(() => {
    jest.resetAllMocks();
    service = new MonthlyReportsService(
      prisma as any,
      {} as any,
      undefined,
      artifacts as any,
      lock as any,
    );
    jest.spyOn(service, 'preview').mockResolvedValue({
      auto_calculated: { member_count: 18 },
    } as any);
    findUnique.mockResolvedValueOnce(draft).mockResolvedValueOnce(generated);
    updateMany.mockResolvedValue({ count: 1 });
    artifacts.renderAndUpload.mockResolvedValue(ARTIFACT);
    artifacts.getMetadataUpdate.mockReturnValue(ARTIFACT_METADATA);
    artifacts.deleteArtifact.mockResolvedValue(undefined);
    lock.tryAcquire.mockResolvedValue(true);
    lock.release.mockResolvedValue(undefined);
  });

  it('uploads the PDF before transitioning draft to generated and stores metadata atomically', async () => {
    await service.generate(REPORT_ID, 'system');

    expect(artifacts.renderAndUpload.mock.invocationCallOrder[0]).toBeLessThan(
      updateMany.mock.invocationCallOrder[0],
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { monthly_report_id: REPORT_ID, status: 'draft' },
      data: expect.objectContaining({
        status: 'generated',
        snapshot_data: { member_count: 18 },
        generated_at: expect.any(Date),
        ...ARTIFACT_METADATA,
      }),
    });
  });

  it('leaves the report unchanged when rendering or upload fails', async () => {
    artifacts.renderAndUpload.mockRejectedValueOnce(
      new Error('R2 unavailable'),
    );

    await expect(service.generate(REPORT_ID, 'system')).rejects.toThrow(
      'R2 unavailable',
    );

    expect(updateMany).not.toHaveBeenCalled();
    expect(artifacts.getMetadataUpdate).not.toHaveBeenCalled();
  });

  it('rejects concurrent generation when the per-report lock is held', async () => {
    lock.tryAcquire.mockResolvedValueOnce(false);

    await expect(service.generate(REPORT_ID, 'system')).rejects.toMatchObject({
      code: ErrorCode.MONTHLY_REPORT_GENERATION_LOCK_CONFLICT,
    });

    expect(findUnique).not.toHaveBeenCalled();
    expect(artifacts.renderAndUpload).not.toHaveBeenCalled();
  });

  it('cleans up the uploaded object when the atomic transition loses its race', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.generate(REPORT_ID, 'system')).rejects.toMatchObject({
      code: ErrorCode.MONTHLY_REPORT_NOT_DRAFT,
    });

    expect(artifacts.deleteArtifact).toHaveBeenCalledWith(ARTIFACT);
    expect(lock.release).toHaveBeenCalledWith(
      `monthly-report:generate:${REPORT_ID}`,
    );
  });
});
