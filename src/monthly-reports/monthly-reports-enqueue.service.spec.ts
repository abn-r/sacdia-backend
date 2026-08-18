import { MonthlyReportsService } from './monthly-reports.service';
import { ErrorCode } from '../common/errors/error-codes';
import { BackgroundJobName } from '../background-jobs/background-jobs.types';

const REPORT_ID = '11111111-1111-4111-8111-111111111111';

describe('MonthlyReportsService enqueue generate/regenerate', () => {
  const findUnique = jest.fn();
  const add = jest.fn();
  const prisma = {
    monthly_reports: { findUnique },
  };
  let service: MonthlyReportsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MonthlyReportsService(
      prisma as any,
      {} as any,
      undefined,
      undefined,
      undefined,
      undefined,
      { add } as any,
    );
  });

  it('enqueues generate and leaves the draft unchanged', async () => {
    findUnique.mockResolvedValue({
      monthly_report_id: REPORT_ID,
      status: 'draft',
    });
    add.mockResolvedValue({ id: 'job-1' });

    await expect(service.enqueueGenerate(REPORT_ID, 'user-1')).resolves.toEqual(
      {
        queued: true,
        monthly_report_id: REPORT_ID,
        status: 'draft',
      },
    );

    expect(add).toHaveBeenCalledWith(
      BackgroundJobName.MONTHLY_REPORT_PDF,
      expect.objectContaining({
        reportId: REPORT_ID,
        action: 'generate',
        requestedBy: 'user-1',
      }),
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it('rejects generate enqueue when the report is not a draft', async () => {
    findUnique.mockResolvedValue({
      monthly_report_id: REPORT_ID,
      status: 'generated',
    });

    await expect(
      service.enqueueGenerate(REPORT_ID, 'user-1'),
    ).rejects.toMatchObject({ code: ErrorCode.MONTHLY_REPORT_NOT_DRAFT });
    expect(add).not.toHaveBeenCalled();
  });

  it('enqueues regenerate for a generated report with snapshot', async () => {
    findUnique.mockResolvedValue({
      monthly_report_id: REPORT_ID,
      status: 'submitted',
      snapshot_data: { member_count: 4 },
    });
    add.mockResolvedValue({ id: 'job-2' });

    await expect(service.enqueueRegenerate(REPORT_ID)).resolves.toEqual({
      queued: true,
      monthly_report_id: REPORT_ID,
      status: 'submitted',
    });

    expect(add).toHaveBeenCalledWith(
      BackgroundJobName.MONTHLY_REPORT_PDF,
      expect.objectContaining({
        reportId: REPORT_ID,
        action: 'regenerate',
      }),
      expect.objectContaining({ attempts: 3 }),
    );
  });
});
