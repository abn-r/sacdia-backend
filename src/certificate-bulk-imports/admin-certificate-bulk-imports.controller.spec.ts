import { Test, TestingModule } from '@nestjs/testing';
import { AdminCertificateBulkImportsController } from './admin-certificate-bulk-imports.controller';
import { AdminCertificateBulkImportsService } from './admin-certificate-bulk-imports.service';
import { JwtAuthGuard, GlobalRolesGuard } from '../common/guards';

const service = {
  listPending: jest.fn(),
  getDetail: jest.fn(),
  approveBatch: jest.fn(),
  rejectBatch: jest.fn(),
  approveItem: jest.fn(),
  rejectItem: jest.fn(),
};

const req = { user: { sub: 'reviewer-1' } } as any;

describe('AdminCertificateBulkImportsController', () => {
  let controller: AdminCertificateBulkImportsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminCertificateBulkImportsController],
      providers: [
        { provide: AdminCertificateBulkImportsService, useValue: service },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(GlobalRolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AdminCertificateBulkImportsController);
    jest.clearAllMocks();
  });

  it('lists pending batches for the authenticated reviewer', async () => {
    service.listPending.mockResolvedValue({ items: [], total: 0 });

    await controller.listPending(req, 1, 20);

    expect(service.listPending).toHaveBeenCalledWith('reviewer-1', {
      page: 1,
      limit: 20,
    });
  });

  it('approves a batch', async () => {
    service.approveBatch.mockResolvedValue({ status: 'APPROVED' });

    await controller.approveBatch(req, 'batch-1', { comment: 'ok' });

    expect(service.approveBatch).toHaveBeenCalledWith('reviewer-1', 'batch-1', {
      comment: 'ok',
    });
  });

  it('rejects an item with reason', async () => {
    service.rejectItem.mockResolvedValue({ status: 'REJECTED' });

    await controller.rejectItem(req, 'batch-1', 'item-1', {
      reason: 'ilegible',
    });

    expect(service.rejectItem).toHaveBeenCalledWith(
      'reviewer-1',
      'batch-1',
      'item-1',
      { reason: 'ilegible' },
    );
  });
});
