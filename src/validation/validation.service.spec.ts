import { HttpStatus } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ValidationService } from './validation.service';

describe('ValidationService honor workflow delegation', () => {
  const prisma = {};
  const notifications = {};
  const honorWorkflow = {
    submitForReview: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
  };

  let service: ValidationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ValidationService(
      prisma as any,
      notifications as any,
      honorWorkflow as any,
    );
  });

  it('delegates honor submit to HonorValidationWorkflowService', async () => {
    honorWorkflow.submitForReview.mockResolvedValue({ user_honor_id: 10 });

    await service.submitForReview('honor', 10, 'user-1');

    expect(honorWorkflow.submitForReview).toHaveBeenCalledWith(10, 'user-1');
  });

  it('delegates honor approve to HonorValidationWorkflowService', async () => {
    honorWorkflow.approve.mockResolvedValue({
      id: 10,
      type: 'honor',
      status: 'APPROVED',
    });

    await service.review('honor', 10, 'approved', 'reviewer-1', 'ok');

    expect(honorWorkflow.approve).toHaveBeenCalledWith(10, 'reviewer-1', 'ok');
  });

  it('delegates honor reject to HonorValidationWorkflowService', async () => {
    honorWorkflow.reject.mockResolvedValue({
      id: 10,
      type: 'honor',
      status: 'REJECTED',
    });

    await service.review(
      'honor',
      10,
      'rejected',
      'reviewer-1',
      'Falta evidencia',
    );

    expect(honorWorkflow.reject).toHaveBeenCalledWith(
      10,
      'reviewer-1',
      'Falta evidencia',
    );
  });
});

describe('ValidationService retired class path', () => {
  const prisma = {
    $transaction: jest.fn(),
    enrollments: { findUnique: jest.fn() },
  };
  const honorWorkflow = {
    submitForReview: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
  };
  const service = new ValidationService(
    prisma as never,
    { notifySafe: jest.fn(), sendToSectionRole: jest.fn() } as never,
    honorWorkflow as never,
  );

  async function expectGone(promise: Promise<unknown>) {
    const error = await promise.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).getStatus()).toBe(HttpStatus.GONE);
    expect((error as AppException).code).toBe(
      ErrorCode.INVESTITURE_LEGACY_PIPELINE_RETIRED,
    );
  }

  beforeEach(() => jest.clearAllMocks());

  it('answers 410 to a class submit without reading or writing', async () => {
    await expectGone(service.submitForReview('class', 7, 'member-1'));
    expect(prisma.enrollments.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['approved', 'rejected'] as const)(
    'answers 410 to a class review (%s), even without a comment',
    async (action) => {
      await expectGone(service.review('class', 7, action, 'reviewer-1'));
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(honorWorkflow.approve).not.toHaveBeenCalled();
      expect(honorWorkflow.reject).not.toHaveBeenCalled();
    },
  );

  it('keeps honor submit working', async () => {
    honorWorkflow.submitForReview.mockResolvedValue({ user_honor_id: 9 });
    await service.submitForReview('honor', 9, 'member-1');
    expect(honorWorkflow.submitForReview).toHaveBeenCalledWith(9, 'member-1');
  });
});
