import { Test, TestingModule } from '@nestjs/testing';
import { CertificateBulkImportsController } from './certificate-bulk-imports.controller';
import { CertificateBulkImportsService } from './certificate-bulk-imports.service';
import { CertificateImportFilesService } from './certificate-import-files.service';

const mockService = {
  createDraft: jest.fn(),
  listMine: jest.fn(),
  addItem: jest.fn(),
  removeItem: jest.fn(),
  processOcr: jest.fn(),
  getBatch: jest.fn(),
  updateItem: jest.fn(),
  submit: jest.fn(),
  resubmitItem: jest.fn(),
};

const mockFiles = {
  presign: jest.fn(),
  confirm: jest.fn(),
  download: jest.fn(),
  remove: jest.fn(),
};

const req = { user: { sub: 'user-1' } } as any;

describe('CertificateBulkImportsController', () => {
  let controller: CertificateBulkImportsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CertificateBulkImportsController],
      providers: [
        { provide: CertificateBulkImportsService, useValue: mockService },
        { provide: CertificateImportFilesService, useValue: mockFiles },
      ],
    }).compile();

    controller = module.get(CertificateBulkImportsController);
    jest.clearAllMocks();
  });

  it('creates a member-owned draft batch', async () => {
    const dto = {
      files: [
        { file_url: 'url', file_name: 'cert.jpg', file_type: 'image/jpeg' },
      ],
    } as any;
    mockService.createDraft.mockResolvedValue({ batch_id: 'batch-1' });

    await expect(controller.create(req, dto)).resolves.toEqual({
      status: 'success',
      data: { batch_id: 'batch-1' },
    });
    expect(mockService.createDraft).toHaveBeenCalledWith('user-1', dto);
  });

  it('processes OCR for the authenticated owner', async () => {
    mockService.processOcr.mockResolvedValue({ batch_id: 'batch-1' });

    await controller.processOcr(req, 'batch-1');

    expect(mockService.processOcr).toHaveBeenCalledWith('user-1', 'batch-1');
  });

  it('returns batch detail for the authenticated owner', async () => {
    mockService.getBatch.mockResolvedValue({ batch_id: 'batch-1' });

    await controller.getDetail(req, 'batch-1');

    expect(mockService.getBatch).toHaveBeenCalledWith('user-1', 'batch-1');
  });

  it('updates an item for the authenticated owner', async () => {
    const dto = {
      item_type: 'HONOR',
      honor_id: 1,
      completed_at: '2026-04-12',
    } as any;
    mockService.updateItem.mockResolvedValue({ item_id: 'item-1' });

    await controller.updateItem(req, 'batch-1', 'item-1', dto);

    expect(mockService.updateItem).toHaveBeenCalledWith(
      'user-1',
      'batch-1',
      'item-1',
      dto,
    );
  });

  it('submits a batch for local-field review', async () => {
    mockService.submit.mockResolvedValue({ status: 'SUBMITTED' });

    await controller.submit(req, 'batch-1');

    expect(mockService.submit).toHaveBeenCalledWith('user-1', 'batch-1');
  });

  it('resubmits a rejected item after correction', async () => {
    const dto = {
      item_type: 'CLASS',
      class_id: 2,
      completed_at: '2026-04-12',
    } as any;
    mockService.resubmitItem.mockResolvedValue({ status: 'RESUBMITTED' });

    await controller.resubmitItem(req, 'batch-1', 'item-1', dto);

    expect(mockService.resubmitItem).toHaveBeenCalledWith(
      'user-1',
      'batch-1',
      'item-1',
      dto,
    );
  });

  it('presigns a file for the authenticated owner', async () => {
    const dto = {
      file_name: 'cert.jpg',
      mime_type: 'image/jpeg',
      file_size: 1200,
    };
    mockFiles.presign.mockResolvedValue({ file_id: 'file-1' });

    await expect(controller.presignFile(req, 'batch-1', dto)).resolves.toEqual({
      status: 'success',
      data: { file_id: 'file-1' },
    });
    expect(mockFiles.presign).toHaveBeenCalledWith('user-1', 'batch-1', dto);
  });
});
