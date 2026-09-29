import { AdminInstitutionalCertificateRequestsController } from './admin-institutional-certificate-requests.controller';
import { InstitutionalCertificateRequestsService } from './institutional-certificate-requests.service';

describe('AdminInstitutionalCertificateRequestsController', () => {
  const service = {
    listForReview: jest.fn(),
    getForReview: jest.fn(),
    approve: jest.fn(),
    reject: jest.fn(),
  };
  const controller = new AdminInstitutionalCertificateRequestsController(
    service as unknown as InstitutionalCertificateRequestsService,
  );
  const req = { user: { sub: 'super-1' } };

  beforeEach(() => jest.clearAllMocks());

  it('passes review filters to the super-admin service', async () => {
    service.listForReview.mockResolvedValue({ items: [], total: 0 });

    await controller.list(req, '1', '20', 'PENDING_REVIEW', '9', 'Ana');

    expect(service.listForReview).toHaveBeenCalledWith('super-1', 1, 20, {
      status: 'PENDING_REVIEW',
      classId: 9,
      q: 'Ana',
    });
  });

  it('approves and rejects without treating the result as an enrollment', async () => {
    service.approve.mockResolvedValue({
      status: 'APPROVED',
      enrollment_created: false,
    });
    service.reject.mockResolvedValue({
      status: 'REJECTED',
      enrollment_created: false,
    });

    await expect(
      controller.approve(req, 'request-1', { expected_revision: 0 }),
    ).resolves.toMatchObject({
      data: { enrollment_created: false },
    });
    await controller.reject(req, 'request-1', {
      expected_revision: 1,
      reason: 'No coincide',
    });

    expect(service.approve).toHaveBeenCalledWith('super-1', 'request-1', {
      expected_revision: 0,
    });
    expect(service.reject).toHaveBeenCalledWith('super-1', 'request-1', {
      expected_revision: 1,
      reason: 'No coincide',
    });
  });
});
