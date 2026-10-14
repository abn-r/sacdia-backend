import { AnnualReportsPdfService } from './annual-reports-pdf.service';

describe('AnnualReportsPdfService year label fallback', () => {
  it('labels the PDF by the UTC start year when computed data has no label, whatever the server timezone', async () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'America/Mexico_City';
    try {
      const prisma = {
        annual_reports: {
          findUnique: jest.fn().mockResolvedValue({
            annual_report_id: 1,
            computed_data: {},
            manual_data: {},
            club: { name: 'Club' },
            ecclesiastical_year: {
              start_date: new Date('2026-01-01T00:00:00.000Z'),
              end_date: new Date('2026-12-31T00:00:00.000Z'),
            },
            finalized_by_user: null,
          }),
        },
      };
      const i18n = { translate: jest.fn((key: string) => key) };
      const translationService = { getCurrentLocale: () => 'es' };
      const service = new AnnualReportsPdfService(
        prisma as any,
        i18n as any,
        translationService as any,
      );
      const drawHeader = jest
        .spyOn(service as any, 'drawHeader')
        .mockImplementation(() => undefined);
      for (const method of [
        'drawSectionTitle',
        'drawSummary',
        'drawTeachings',
        'drawActivities',
        'drawFinances',
        'drawMissionary',
        'drawRanking',
        'drawDirectorInfo',
        'drawFooter',
      ]) {
        jest.spyOn(service as any, method).mockImplementation(() => undefined);
      }

      await service.generatePdf(1);

      expect(drawHeader.mock.calls[0][4]).toBe('2026');
    } finally {
      process.env.TZ = originalTz;
    }
  });
});
