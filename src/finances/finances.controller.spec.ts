import { FinancesController } from './finances.controller';

describe('FinancesController (reports routes)', () => {
  const financesService = { remove: jest.fn(), getSummary: jest.fn() };
  const reports = {
    getOverview: jest.fn(),
    getByCategory: jest.fn(),
    buildExport: jest.fn(),
  };
  let controller: FinancesController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new FinancesController(financesService as any, reports as any);
  });

  const reqWithSection = (sectionId?: number) => ({
    user: { sub: 'user-1' },
    authorization: {
      effective: {
        scope: {
          club: sectionId ? { section: { club_section_id: sectionId } } : null,
        },
      },
    },
  });

  it('overview passes the caller id and the query', async () => {
    reports.getOverview.mockResolvedValue({ data: [] });

    await controller.getOverview({ year: 2026 }, reqWithSection());

    expect(reports.getOverview).toHaveBeenCalledWith('user-1', { year: 2026 });
  });

  it('export writes the xlsx headers and ends the response with the buffer', async () => {
    const buffer = Buffer.from('xlsx');
    reports.buildExport.mockResolvedValue({
      buffer,
      contentType: 'application/vnd.test',
      contentDisposition: 'attachment; filename="finanzas-a-2026.xlsx"',
    });
    const res = { set: jest.fn(), end: jest.fn() };

    await controller.exportMovements(
      1,
      { year: 2026 },
      res as any,
      reqWithSection(7),
    );

    expect(reports.buildExport).toHaveBeenCalledWith(1, { year: 2026 }, 7, {
      userId: 'user-1',
      authorization: expect.any(Object),
    });
    expect(res.set).toHaveBeenCalledWith({
      'Content-Type': 'application/vnd.test',
      'Content-Disposition': 'attachment; filename="finanzas-a-2026.xlsx"',
      'Content-Length': buffer.length,
    });
    expect(res.end).toHaveBeenCalledWith(buffer);
  });

  it('export sets Cache-Control only when the file asks for it (pdf)', async () => {
    const buffer = Buffer.from('%PDF');
    reports.buildExport.mockResolvedValue({
      buffer,
      contentType: 'application/pdf',
      contentDisposition: 'attachment; filename="finanzas-a-2026.pdf"',
      cacheControl: 'no-store',
    });
    const res = { set: jest.fn(), end: jest.fn() };

    await controller.exportMovements(
      1,
      { year: 2026, format: 'pdf' },
      res as any,
      reqWithSection(7),
    );

    expect(reports.buildExport).toHaveBeenCalledWith(
      1,
      { year: 2026, format: 'pdf' },
      7,
      { userId: 'user-1', authorization: expect.any(Object) },
    );
    expect(res.set).toHaveBeenCalledWith({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="finanzas-a-2026.pdf"',
      'Content-Length': buffer.length,
      'Cache-Control': 'no-store',
    });
  });

  it('by-category and summary scope a section member to their section', async () => {
    reports.getByCategory.mockResolvedValue({});
    financesService.getSummary.mockResolvedValue({});

    await controller.getByCategory(1, { year: 2026 }, reqWithSection(7));
    await controller.getSummary(1, 2026, 3, 9, reqWithSection(7));

    expect(reports.getByCategory).toHaveBeenCalledWith(1, { year: 2026 }, 7);
    expect(financesService.getSummary).toHaveBeenCalledWith(1, 2026, 3, 7, 9);
  });

  it('remove takes the reason from the body first, then from ?reason=', async () => {
    await controller.remove(
      5,
      { user: { sub: 'u' } },
      { reason: 'del body' },
      'del query',
    );
    await controller.remove(5, { user: { sub: 'u' } }, undefined, 'del query');

    expect(financesService.remove).toHaveBeenNthCalledWith(
      1,
      5,
      'u',
      'del body',
    );
    expect(financesService.remove).toHaveBeenNthCalledWith(
      2,
      5,
      'u',
      'del query',
    );
  });

  it('declares the overview route before the :financeId route so it is not swallowed', () => {
    const proto = FinancesController.prototype;
    const names = Object.getOwnPropertyNames(proto);
    expect(names.indexOf('getOverview')).toBeLessThan(names.indexOf('findOne'));
  });
});
