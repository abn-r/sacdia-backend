import { AppBadRequestException } from '../common/errors/app.exception';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import { ErrorCode } from '../common/errors/error-codes';
import {
  MONTHLY_REPORT_PDF_TEMPLATE_VERSION,
  buildMonthlyReportPdfKey,
} from './monthly-report-artifact.constants';
import { MonthlyReportArtifactsService } from './monthly-report-artifacts.service';

const REPORT_ID = '11111111-1111-4111-8111-111111111111';
const ENROLLMENT_ID = '22222222-2222-4222-8222-222222222222';
const PDF = Buffer.from('%PDF-monthly-report');
const STORED_KEY = `monthly-reports/2026/08/${ENROLLMENT_ID}/${REPORT_ID}.pdf`;

function generatedReport(overrides: Record<string, unknown> = {}) {
  return {
    monthly_report_id: REPORT_ID,
    club_enrollment_id: ENROLLMENT_ID,
    month: 8,
    year: 2026,
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

describe('MonthlyReportArtifactsService', () => {
  const findUnique = jest.fn();
  const update = jest.fn();
  const upload = jest.fn();
  const deleteMany = jest.fn();
  const getObjectInfo = jest.fn();
  const getSignedDownloadUrl = jest.fn();
  const generatePdf = jest.fn();
  const fileStorage = {
    [FILE_STORAGE_SERVICE]: undefined,
    upload,
    deleteMany,
    getObjectInfo,
    getSignedDownloadUrl,
  };
  const prisma = {
    monthly_reports: { findUnique, update },
  };
  const pdfService = { generatePdf };
  let service: MonthlyReportArtifactsService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MonthlyReportArtifactsService(
      prisma as any,
      pdfService as any,
      fileStorage as any,
    );
    generatePdf.mockResolvedValue(PDF);
    upload.mockResolvedValue({
      key: STORED_KEY,
      url: 'https://private.invalid',
    });
    deleteMany.mockResolvedValue(undefined);
    update.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...generatedReport(),
        ...data,
      }),
    );
    getObjectInfo.mockResolvedValue({
      size: PDF.length,
      contentType: 'application/pdf',
    });
    getSignedDownloadUrl.mockResolvedValue(
      'https://signed.invalid/monthly-report',
    );
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => PDF,
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('uploads the deterministic key with PDF content type and complete integrity metadata', async () => {
    findUnique.mockResolvedValueOnce(generatedReport());

    const result = await service.renderAndUpload({ reportId: REPORT_ID });

    expect(upload).toHaveBeenCalledWith(
      StorageBucketAlias.MONTHLY_REPORTS,
      buildMonthlyReportPdfKey({
        reportId: REPORT_ID,
        enrollmentId: ENROLLMENT_ID,
        month: 8,
        year: 2026,
      }),
      PDF,
      { contentType: 'application/pdf', overwrite: true },
    );
    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        reportId: REPORT_ID,
        key: STORED_KEY,
        sizeBytes: PDF.length,
        templateVersion: MONTHLY_REPORT_PDF_TEMPLATE_VERSION,
      }),
    );
  });

  it('persists artifact metadata only when the caller explicitly requests it', async () => {
    findUnique.mockResolvedValueOnce(generatedReport());

    const artifact = await service.renderAndUpload({ reportId: REPORT_ID });
    await service.persistArtifactMetadata(REPORT_ID, artifact);

    expect(update).toHaveBeenCalledWith({
      where: { monthly_report_id: REPORT_ID },
      data: {
        pdf_r2_key: STORED_KEY,
        pdf_size_bytes: BigInt(PDF.length),
        pdf_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        pdf_generated_at: expect.any(Date),
        pdf_template_version: MONTHLY_REPORT_PDF_TEMPLATE_VERSION,
      },
    });
  });

  it('uses the same canonical key when a report is regenerated', async () => {
    findUnique.mockResolvedValue(generatedReport());

    await service.renderAndUpload({ reportId: REPORT_ID });
    await service.renderAndUpload({ reportId: REPORT_ID });

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[0][1]).toBe(upload.mock.calls[1][1]);
  });

  it('deletes a just-uploaded artifact through the private bucket alias', async () => {
    await service.deleteArtifact({
      reportId: REPORT_ID,
      key: STORED_KEY,
      sizeBytes: PDF.length,
      sha256: 'a'.repeat(64),
      generatedAt: new Date(),
      templateVersion: MONTHLY_REPORT_PDF_TEMPLATE_VERSION,
    });

    expect(deleteMany).toHaveBeenCalledWith(
      StorageBucketAlias.MONTHLY_REPORTS,
      [STORED_KEY],
    );
  });

  it('does not update metadata when the R2 upload fails', async () => {
    findUnique.mockResolvedValueOnce(generatedReport());
    upload.mockRejectedValueOnce(new Error('R2 unavailable'));

    await expect(
      service.renderAndUpload({ reportId: REPORT_ID }),
    ).rejects.toThrow('R2 unavailable');

    expect(update).not.toHaveBeenCalled();
  });

  it('rejects stored PDF retrieval for draft reports', async () => {
    findUnique.mockResolvedValueOnce(generatedReport({ status: 'draft' }));

    await expect(service.getStoredPdfBuffer(REPORT_ID)).rejects.toMatchObject({
      code: ErrorCode.REPORT_PDF_NOT_GENERATED,
    } satisfies Partial<AppBadRequestException>);

    expect(getSignedDownloadUrl).not.toHaveBeenCalled();
  });

  it('repairs missing or outdated metadata from the frozen snapshot before download', async () => {
    findUnique
      .mockResolvedValueOnce(
        generatedReport({ snapshot_data: { member_count: 21 } }),
      )
      .mockResolvedValueOnce(
        generatedReport({ snapshot_data: { member_count: 21 } }),
      );

    const result = await service.getStoredPdfBuffer(REPORT_ID);

    expect(generatePdf).toHaveBeenCalledWith(REPORT_ID, { member_count: 21 });
    expect(update).toHaveBeenCalled();
    expect(getSignedDownloadUrl).toHaveBeenCalledWith(
      StorageBucketAlias.MONTHLY_REPORTS,
      STORED_KEY,
      { expiresInSeconds: 300 },
    );
    expect(result).toEqual(PDF);
  });

  it('reads a current stored object through a short-lived signed URL', async () => {
    findUnique.mockResolvedValueOnce(
      generatedReport({
        pdf_r2_key: STORED_KEY,
        pdf_size_bytes: BigInt(PDF.length),
        pdf_sha256: 'a'.repeat(64),
        pdf_generated_at: new Date(),
        pdf_template_version: MONTHLY_REPORT_PDF_TEMPLATE_VERSION,
      }),
    );

    await service.getStoredPdfBuffer(REPORT_ID);

    expect(getObjectInfo).toHaveBeenCalledWith(
      StorageBucketAlias.MONTHLY_REPORTS,
      STORED_KEY,
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://signed.invalid/monthly-report',
    );
  });
});
