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
