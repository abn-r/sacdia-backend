import { InstitutionalCertificateRequestsController } from './institutional-certificate-requests.controller';
import { InstitutionalCertificateRequestsService } from './institutional-certificate-requests.service';

describe('InstitutionalCertificateRequestsController', () => {
  const service = {
    submit: jest.fn(),
    listMine: jest.fn(),
    getMine: jest.fn(),
  };
  const controller = new InstitutionalCertificateRequestsController(
    service as unknown as InstitutionalCertificateRequestsService,
  );
  const req = { user: { sub: 'owner-1' } };

  beforeEach(() => jest.clearAllMocks());

  it('submits with the JWT owner', async () => {
    service.submit.mockResolvedValue({ request_id: 'request-1' });
    const dto = {
      class_id: 9,
      file_id: 'file-1',
      completed_at: '2008-07-07',
    };

    await expect(controller.submit(req, dto)).resolves.toEqual({
      status: 'success',
      data: { request_id: 'request-1' },
    });
    expect(service.submit).toHaveBeenCalledWith('owner-1', dto);
  });

  it('lists and reads only the authenticated owner', async () => {
    service.listMine.mockResolvedValue({ items: [], total: 0 });
    service.getMine.mockResolvedValue({ request_id: 'request-1' });

    await controller.listMine(req, '2', '10');
    await controller.getMine(req, 'request-1');

    expect(service.listMine).toHaveBeenCalledWith('owner-1', 2, 10);
    expect(service.getMine).toHaveBeenCalledWith('owner-1', 'request-1');
  });
});
