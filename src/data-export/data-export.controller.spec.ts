import { Test, TestingModule } from '@nestjs/testing';
import { DataExportController } from './data-export.controller';
import { DataExportService } from './data-export.service';
import { JwtAuthGuard } from '../common/guards';
import { UserAwareThrottlerGuard } from '../config/user-aware-throttler.guard';

const mockDataExportService = {
  requestExport: jest.fn(),
  listExports: jest.fn(),
  getDownloadUrl: jest.fn(),
};

const mockReq = (
  sub: string,
  headers: Record<string, string> = {},
  ip = '203.0.113.45',
) => ({
  user: { sub, email: 'user@test.com' },
  headers,
  ip,
  socket: { remoteAddress: '127.0.0.1' },
});

const mockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('DataExportController', () => {
  let controller: DataExportController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DataExportController],
      providers: [
        { provide: DataExportService, useValue: mockDataExportService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(UserAwareThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DataExportController>(DataExportController);
    jest.clearAllMocks();
  });

  describe('requestExport', () => {
    it('returns 201 for a new export', async () => {
      const req = mockReq('user-1') as any;
      const res = mockRes();
      mockDataExportService.requestExport.mockResolvedValueOnce({
        status: 201,
        data: {
          export_id: 'exp-1',
          status: 'pending',
          created_at: new Date().toISOString(),
        },
      });

      await controller.requestExport(req, { format: 'json' }, res);
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalled();
    });

    it('returns 200 for in-progress export', async () => {
      const req = mockReq('user-1') as any;
      const res = mockRes();
      mockDataExportService.requestExport.mockResolvedValueOnce({
        status: 200,
        data: {
          export_id: 'exp-1',
          status: 'processing',
          created_at: new Date().toISOString(),
        },
      });

      await controller.requestExport(req, { format: 'json' }, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('listExports', () => {
    it('returns list of exports', async () => {
      const req = mockReq('user-1') as any;
      mockDataExportService.listExports.mockResolvedValueOnce({ exports: [] });

      const result = await controller.listExports(req);
      expect(result).toEqual({ exports: [] });
      expect(mockDataExportService.listExports).toHaveBeenCalledWith('user-1');
    });
  });

  describe('getDownloadUrl', () => {
    it('calls service with userId, exportId and ip', async () => {
      const req = mockReq('user-1', {
        'x-forwarded-for': '10.0.0.1, 10.0.0.2',
      }) as any;
      mockDataExportService.getDownloadUrl.mockResolvedValueOnce({
        url: 'https://example.com/signed',
        expires_at: new Date().toISOString(),
      });

      const result = await controller.getDownloadUrl(req, 'exp-1');
      expect(result.url).toBe('https://example.com/signed');
      expect(mockDataExportService.getDownloadUrl).toHaveBeenCalledWith(
        'user-1',
        'exp-1',
        '203.0.113.45',
      );
    });
  });
});
