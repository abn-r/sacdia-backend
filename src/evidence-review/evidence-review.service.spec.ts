import { EvidenceReviewService } from './evidence-review.service';
import { ErrorCode } from '../common/errors/error-codes';

describe('EvidenceReviewService', () => {
  const mockPrisma = {
    folders_section_records: { findMany: jest.fn() },
    class_section_progress: { findMany: jest.fn() },
    users_honors: { findMany: jest.fn() },
    validation_logs: { findMany: jest.fn() },
  };

  const service = new EvidenceReviewService(
    mockPrisma as any,
    {
      emitEvent: jest.fn(),
    } as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.class_section_progress.findMany.mockResolvedValue([]);
    mockPrisma.users_honors.findMany.mockResolvedValue([]);
    mockPrisma.validation_logs.findMany.mockResolvedValue([]);
  });

  it('lists pending class and honor evidence without querying legacy folder records', async () => {
    await service.getPending();

    expect(mockPrisma.folders_section_records.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.class_section_progress.findMany).toHaveBeenCalled();
    expect(mockPrisma.users_honors.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          validation_status: 'PENDING_REVIEW',
        }),
      }),
    );
  });

  it('rejects folder as an evidence-review type', async () => {
    await expect(service.getDetail('folder' as any, 1)).rejects.toMatchObject({
      code: ErrorCode.EVIDENCE_REVIEW_TYPE_INVALID,
    });
  });
});
