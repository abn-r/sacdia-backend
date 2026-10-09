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

describe('ValidationService class pipeline', () => {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    enrollments: { update: jest.fn() },
    investiture_authorization_people: {
      findFirst: jest.fn(),
    },
    investiture_validation_history: { create: jest.fn() },
    validation_logs: { create: jest.fn() },
  };
  const prisma = {
    enrollments: { findUnique: jest.fn() },
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
    club_role_assignments: { findFirst: jest.fn() },
  };
  const notifications = {
    sendToSectionRole: jest.fn(),
    notifySafe: jest.fn(),
  };
  const honorWorkflow = {
    submitForReview: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
  };
  let service: ValidationService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx.investiture_authorization_people.findFirst.mockResolvedValue({
      person_id: 'person-1',
    });
    prisma.enrollments.findUnique.mockResolvedValue({
      enrollment_id: 4,
      user_id: 'member-1',
      investiture_status: 'IN_PROGRESS',
    });
    service = new ValidationService(
      prisma as never,
      notifications as never,
      honorWorkflow as never,
    );
  });

  it('does not submit a class enrollment that has a pending authorization', async () => {
    await expect(
      service.submitForReview('class', 4, 'member-1'),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_PROGRESS_LOCKED,
    });
    expect(tx.enrollments.update).not.toHaveBeenCalled();
    expect(honorWorkflow.submitForReview).not.toHaveBeenCalled();
  });

  it('does not review a class enrollment that has a pending authorization', async () => {
    prisma.enrollments.findUnique.mockResolvedValue({
      enrollment_id: 4,
      user_id: 'member-1',
      investiture_status: 'SUBMITTED_FOR_VALIDATION',
    });

    await expect(
      service.review('class', 4, 'approved', 'reviewer-1'),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_REQUEST_PROGRESS_LOCKED,
    });
    expect(tx.enrollments.update).not.toHaveBeenCalled();
    expect(honorWorkflow.approve).not.toHaveBeenCalled();
  });

  it('does not submit a class when the status changed under the lock', async () => {
    tx.investiture_authorization_people.findFirst.mockResolvedValue(null);
    tx.enrollments.updateMany = jest.fn().mockResolvedValue({ count: 0 });

    await expect(
      service.submitForReview('class', 4, 'member-1'),
    ).rejects.toMatchObject({
      code: ErrorCode.INVESTITURE_CONCURRENT_UPDATE,
    });
    expect(tx.investiture_validation_history.create).not.toHaveBeenCalled();
    expect(notifications.notifySafe).not.toHaveBeenCalled();
    expect(notifications.sendToSectionRole).not.toHaveBeenCalled();
  });
});
