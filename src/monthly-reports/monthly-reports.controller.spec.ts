import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { AUTHORIZATION_RESOURCE_KEY } from '../common/decorators/authorization-resource.decorator';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { MonthlyReportsController } from './monthly-reports.controller';

const REPORT_ID = '11111111-1111-4111-8111-111111111111';
const PDF = Buffer.from('%PDF-monthly-report');

describe('MonthlyReportsController stored PDF contract', () => {
  let controller: MonthlyReportsController;
  let reportsService: {
    enqueueRegenerate: jest.Mock;
  };
  let artifactsService: {
    getStoredPdfBuffer: jest.Mock;
  };

  beforeEach(() => {
    reportsService = {
      enqueueRegenerate: jest.fn().mockResolvedValue({
        monthly_report_id: REPORT_ID,
        status: 'submitted',
      }),
    };
    artifactsService = {
      getStoredPdfBuffer: jest.fn().mockResolvedValue(PDF),
    };
    controller = new MonthlyReportsController(
      reportsService as any,
      artifactsService as any,
    );
  });

  it('downloads the stored artifact with the existing PDF response headers', async () => {
    const response = {
      set: jest.fn(),
      end: jest.fn(),
    };

    await controller.downloadPdf(REPORT_ID, response as any);

    expect(artifactsService.getStoredPdfBuffer).toHaveBeenCalledWith(REPORT_ID);
    expect(response.set).toHaveBeenCalledWith({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="informe-mensual-${REPORT_ID}.pdf"`,
      'Content-Length': PDF.length,
    });
    expect(response.end).toHaveBeenCalledWith(PDF);
  });

  it('delegates regeneration and returns the standard success envelope', async () => {
    await expect(controller.regenerate(REPORT_ID)).resolves.toEqual({
      status: 'success',
      data: {
        monthly_report_id: REPORT_ID,
        status: 'submitted',
      },
    });

    expect(reportsService.enqueueRegenerate).toHaveBeenCalledWith(REPORT_ID);
  });

  it('returns accepted when regeneration is queued', async () => {
    reportsService.enqueueRegenerate.mockResolvedValueOnce({
      queued: true,
      monthly_report_id: REPORT_ID,
      status: 'submitted',
    });

    await expect(controller.regenerate(REPORT_ID)).resolves.toEqual({
      status: 'accepted',
      data: {
        queued: true,
        monthly_report_id: REPORT_ID,
        status: 'submitted',
      },
    });
  });

  it('protects regeneration with reports:write and monthly-report resource scope', () => {
    const handler = MonthlyReportsController.prototype.regenerate;

    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual({
      permissions: ['reports:write'],
      mode: 'all',
    });
    expect(Reflect.getMetadata(AUTHORIZATION_RESOURCE_KEY, handler)).toEqual({
      type: 'monthly_report',
      idParam: 'reportId',
    });
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(
      ':reportId/regenerate',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(1);
  });
});
