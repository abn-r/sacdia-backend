import * as XLSX from 'xlsx';
import {
  FINANCE_EXPORT_MAX_ROWS,
  FinanceReportsService,
} from './finance-reports.service';
import { ErrorCode } from '../common/errors/error-codes';
import { AppBadRequestException } from '../common/errors/app.exception';
import * as pdfModule from './finance-export-pdf';

type Role = { role: string; permissions?: string[] };

function profile(
  roles: Role[],
  ids: { localFieldId?: number; unionId?: number; divisionId?: number } = {},
) {
  return {
    authorization: {
      grants: {
        global_roles: roles.map((r) => ({
          role_name: r.role,
          permissions: r.permissions ?? ['finances:read'],
          scope: {},
        })),
        club_assignments: [],
        direct_permissions: [],
      },
      active_assignment: { assignment_id: null },
      effective: {
        permissions: [],
        scope: {
          global: {
            ...(ids.divisionId
              ? { division: { id: ids.divisionId, name: 'DIA' } }
              : {}),
            ...(ids.unionId
              ? { union: { id: ids.unionId, name: 'Unión' } }
              : {}),
            ...(ids.localFieldId
              ? { local_field: { id: ids.localFieldId, name: 'Campo' } }
              : {}),
          },
          club: null,
        },
      },
    },
  } as any;
}

describe('FinanceReportsService', () => {
  const mockPrisma = {
    finances: { findMany: jest.fn() },
    finance_evidence_files: { groupBy: jest.fn() },
    finances_categories: { findMany: jest.fn() },
    clubs: { findMany: jest.fn(), findUnique: jest.fn() },
    users: { findUnique: jest.fn() },
    financePeriodClosing: { findUnique: jest.fn() },
  };
  const mockAggregation = {
    resolveClubScope: jest.fn(),
    aggregate: jest.fn(),
    aggregateByCategory: jest.fn(),
    aggregateMonthlySeries: jest.fn(),
    firstMovementMonth: jest.fn(),
    aggregateByClub: jest.fn(),
  };
  const mockScore = { getMonthsStatus: jest.fn() };
  const mockAuth = { resolveUserAuthorization: jest.fn() };
  const mockResponsibles = { forSections: jest.fn() };
  const mockTranslation = {
    getCurrentLocale: jest.fn(),
    translateMany: jest.fn(),
  };
  let service: FinanceReportsService;

  const scope = {
    club: { club_id: 1, name: 'Club Panteras' },
    sections: [
      { club_section_id: 10, name: 'Aventureros' },
      { club_section_id: 11, name: 'Conquistadores' },
    ],
    sectionIds: [10, 11],
  };

  beforeEach(() => {
    jest.resetAllMocks();
    mockTranslation.getCurrentLocale.mockReturnValue('es');
    mockTranslation.translateMany.mockImplementation((records) => records);
    mockPrisma.finances_categories.findMany.mockResolvedValue([]);
    mockPrisma.clubs.findUnique.mockResolvedValue({
      local_fields: { name: 'Asociación Centro' },
    });
    mockPrisma.users.findUnique.mockResolvedValue({
      name: 'Admin',
      paternal_last_name: 'SACDIA',
    });
    mockResponsibles.forSections.mockResolvedValue(new Map());
    service = new FinanceReportsService(
      mockPrisma as any,
      mockAggregation as any,
      mockScore as any,
      mockAuth as any,
      mockTranslation as any,
      mockResponsibles as any,
    );
  });

  describe('getByCategory', () => {
    beforeEach(() => {
      mockAggregation.resolveClubScope.mockResolvedValue(scope);
      mockAggregation.aggregateByCategory.mockResolvedValue([
        { category_id: 3, name: 'Cuotas', type: 0, total: 900, count: 3 },
        { category_id: 8, name: 'Material', type: 1, total: 400, count: 2 },
        { category_id: 4, name: 'Donativos', type: 0, total: 300, count: 1 },
        { category_id: 9, name: 'Transporte', type: 1, total: 50, count: 1 },
      ]);
    });

    it('splits income and expenses, keeps the order and totals each side', async () => {
      const result = await service.getByCategory(1, { year: 2026, month: 3 });

      expect(result.income).toEqual([
        { category_id: 3, name: 'Cuotas', total: 900, count: 3 },
        { category_id: 4, name: 'Donativos', total: 300, count: 1 },
      ]);
      expect(result.expenses).toEqual([
        { category_id: 8, name: 'Material', total: 400, count: 2 },
        { category_id: 9, name: 'Transporte', total: 50, count: 1 },
      ]);
      expect(result.totals).toEqual({ income: 1200, expenses: 450 });
      expect(result.period).toBe('2026-03');
      expect(mockAggregation.aggregateByCategory).toHaveBeenCalledWith(
        [10, 11],
        { from: { year: 2026, month: 3 }, to: { year: 2026, month: 3 } },
      );
    });

    it('covers the whole year when month is omitted and narrows by section', async () => {
      await service.getByCategory(1, { year: 2026, club_section_id: 11 }, null);

      expect(mockAggregation.resolveClubScope).toHaveBeenCalledWith(
        1,
        11,
        null,
      );
      expect(mockAggregation.aggregateByCategory).toHaveBeenCalledWith(
        [10, 11],
        { from: { year: 2026, month: 1 }, to: { year: 2026, month: 12 } },
      );
    });

    it('uses the translated category names', async () => {
      mockPrisma.finances_categories.findMany.mockResolvedValue([
        { finance_category_id: 3, name: 'Cuotas', translations: [] },
      ]);
      mockTranslation.translateMany.mockReturnValue([
        { finance_category_id: 3, name: 'Fees' },
      ]);

      const result = await service.getByCategory(1, { year: 2026 });

      expect(result.income[0].name).toBe('Fees');
      expect(result.income[1].name).toBe('Donativos');
    });

    it('propagates the 403 / 404 of the scope resolver', async () => {
      mockAggregation.resolveClubScope.mockRejectedValue({
        code: ErrorCode.GUARD_PERMISSION_DENIED,
      });

      await expect(
        service.getByCategory(1, { year: 2026, club_section_id: 11 }, 10),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
      expect(mockAggregation.aggregateByCategory).not.toHaveBeenCalled();
    });
  });

  describe('getMonthlySeries', () => {
    const points = [
      { year: 2026, month: 1, income: 5, expenses: 2, net: 3, balance: 3 },
    ];

    beforeEach(() => {
      mockAggregation.resolveClubScope.mockResolvedValue(scope);
      mockAggregation.aggregateMonthlySeries.mockResolvedValue(points);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('uses the explicit range and the scoped sections', async () => {
      const result = await service.getMonthlySeries(
        1,
        { from: '2026-01', to: '2026-03', club_section_id: 10 },
        null,
      );

      expect(mockAggregation.resolveClubScope).toHaveBeenCalledWith(
        1,
        10,
        null,
      );
      expect(mockAggregation.aggregateMonthlySeries).toHaveBeenCalledWith(
        [10, 11],
        { year: 2026, month: 1 },
        { year: 2026, month: 3 },
      );
      expect(result).toEqual({
        club_id: 1,
        club_section_id: 10,
        from: '2026-01',
        to: '2026-03',
        items: points,
      });
    });

    it('defaults `to` to the current month and `from` to the first movement', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 10, 12));
      mockAggregation.firstMovementMonth.mockResolvedValue({
        year: 2026,
        month: 9,
      });

      const result = await service.getMonthlySeries(1, {}, 7);

      expect(mockAggregation.resolveClubScope).toHaveBeenCalledWith(
        1,
        undefined,
        7,
      );
      expect(mockAggregation.aggregateMonthlySeries).toHaveBeenCalledWith(
        [10, 11],
        { year: 2026, month: 9 },
        { year: 2026, month: 11 },
      );
      expect(result.from).toBe('2026-09');
      expect(result.to).toBe('2026-11');
    });

    it('returns an empty list when there are no movements', async () => {
      mockAggregation.firstMovementMonth.mockResolvedValue(null);

      await expect(service.getMonthlySeries(1, {})).resolves.toEqual({
        club_id: 1,
        club_section_id: null,
        from: null,
        to: null,
        items: [],
      });
      expect(mockAggregation.aggregateMonthlySeries).not.toHaveBeenCalled();
    });

    it('rejects an inverted explicit range', async () => {
      await expect(
        service.getMonthlySeries(1, { from: '2026-05', to: '2026-02' }),
      ).rejects.toBeInstanceOf(AppBadRequestException);
    });

    it('rejects more than 120 months and accepts exactly 120', async () => {
      await expect(
        service.getMonthlySeries(1, { from: '2016-01', to: '2026-01' }),
      ).rejects.toBeInstanceOf(AppBadRequestException);
      await expect(
        service.getMonthlySeries(1, { from: '2016-01', to: '2025-12' }),
      ).resolves.toMatchObject({ from: '2016-01', to: '2025-12' });
    });

    it('propagates scope errors (403/404) without querying', async () => {
      mockAggregation.resolveClubScope.mockRejectedValue(new Error('403'));
      await expect(service.getMonthlySeries(1, {})).rejects.toThrow('403');
      expect(mockAggregation.aggregateMonthlySeries).not.toHaveBeenCalled();
    });
  });

  describe('buildExport', () => {
    const movement = (over: Record<string, unknown> = {}) => ({
      finance_id: 1,
      finance_date: new Date('2026-03-15T00:00:00Z'),
      club_section_id: 10,
      amount: 500,
      description: 'Cuota de marzo',
      post_closing_note: null,
      finance_category_id: 3,
      finances_categories: { type: 0, name: 'Cuotas' },
      users: { name: 'Ana', paternal_last_name: 'Pérez' },
      ...over,
    });

    beforeEach(() => {
      mockAggregation.resolveClubScope.mockResolvedValue(scope);
      mockAggregation.aggregate.mockResolvedValue({
        income: 500,
        expenses: 120,
        net: 380,
        movements: 2,
        balance: 7000,
      });
      mockPrisma.finances.findMany.mockResolvedValue([
        movement(),
        movement({
          finance_id: 2,
          club_section_id: 11,
          amount: 120,
          description: null,
          post_closing_note: 'Ajuste autorizado',
          finance_category_id: 8,
          finances_categories: { type: 1, name: 'Material' },
        }),
      ]);
      mockPrisma.finance_evidence_files.groupBy.mockResolvedValue([
        { finance_id: 1, _count: { _all: 2 } },
      ]);
    });

    it('builds a workbook with the movements sheet and a summary sheet', async () => {
      const file = await service.buildExport(1, { year: 2026, month: 3 });

      const wb = XLSX.read(file.buffer, { type: 'buffer' });
      expect(wb.SheetNames).toEqual(['Movimientos', 'Resumen']);

      const rows = XLSX.utils.sheet_to_json<unknown[]>(
        wb.Sheets['Movimientos'],
        { header: 1 },
      );
      expect(rows[0]).toEqual([
        'Fecha',
        'Sección',
        'Tipo',
        'Categoría',
        'Descripción',
        'Monto',
        'Registró',
        'Evidencias',
        'Nota de cierre',
      ]);
      expect(rows[1]).toEqual([
        '2026-03-15',
        'Aventureros',
        'Ingreso',
        'Cuotas',
        'Cuota de marzo',
        500,
        'Ana Pérez',
        2,
        '',
      ]);
      expect(rows[2]).toEqual([
        '2026-03-15',
        'Conquistadores',
        'Egreso',
        'Material',
        '',
        120,
        'Ana Pérez',
        0,
        'Ajuste autorizado',
      ]);

      const summary = XLSX.utils.sheet_to_json<unknown[]>(
        wb.Sheets['Resumen'],
        {
          header: 1,
        },
      );
      expect(summary).toEqual(
        expect.arrayContaining([
          ['Ingresos', 500],
          ['Egresos', 120],
          ['Neto', 380],
          ['Saldo acumulado', 7000],
        ]),
      );
    });

    it('returns xlsx headers and an ASCII-safe filename', async () => {
      mockAggregation.resolveClubScope.mockResolvedValue({
        ...scope,
        club: { club_id: 1, name: 'Águilas del Ñandú' },
      });

      const file = await service.buildExport(1, { year: 2026, month: 3 });

      expect(file.contentType).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(file.filename).toBe('finanzas-Aguilas-del-Nandu-2026-03.xlsx');
      expect(file.filename).toMatch(/^[\x20-\x7e]+$/);
      expect(file.contentDisposition).toContain(
        'attachment; filename="finanzas-Aguilas-del-Nandu-2026-03.xlsx"',
      );
    });

    it('names a whole-year export with the year only and filters by year', async () => {
      const file = await service.buildExport(1, { year: 2026 });

      expect(file.filename).toBe('finanzas-Club-Panteras-2026.xlsx');
      const where = mockPrisma.finances.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        active: true,
        year: 2026,
        club_section_id: { in: [10, 11] },
      });
      expect(where).not.toHaveProperty('month');
    });

    it('passes the member section to the scope resolver and exports only active movements', async () => {
      await service.buildExport(1, { year: 2026, club_section_id: 10 }, 10);

      expect(mockAggregation.resolveClubScope).toHaveBeenCalledWith(1, 10, 10);
      expect(mockPrisma.finances.findMany.mock.calls[0][0].where.active).toBe(
        true,
      );
    });

    it('does not build a file when the scope is forbidden or missing', async () => {
      mockAggregation.resolveClubScope.mockRejectedValueOnce({
        code: ErrorCode.GUARD_PERMISSION_DENIED,
      });
      await expect(
        service.buildExport(1, { year: 2026, club_section_id: 11 }, 10),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });

      mockAggregation.resolveClubScope.mockRejectedValueOnce({
        code: ErrorCode.CLUB_SECTION_NOT_FOUND,
      });
      await expect(
        service.buildExport(1, { year: 2026, club_section_id: 99 }),
      ).rejects.toMatchObject({ code: ErrorCode.CLUB_SECTION_NOT_FOUND });
      expect(mockPrisma.finances.findMany).not.toHaveBeenCalled();
    });

    it('xlsx stays the default when format is absent or xlsx', async () => {
      const a = await service.buildExport(1, { year: 2026, month: 3 });
      const b = await service.buildExport(1, {
        year: 2026,
        month: 3,
        format: 'xlsx',
      });

      expect(a.filename.endsWith('.xlsx')).toBe(true);
      expect(b.filename).toBe(a.filename);
      expect(a.cacheControl).toBeUndefined();
      expect(XLSX.read(b.buffer, { type: 'buffer' }).SheetNames).toEqual([
        'Movimientos',
        'Resumen',
      ]);
      expect(mockPrisma.financePeriodClosing.findUnique).not.toHaveBeenCalled();
    });

    describe('pdf format', () => {
      beforeEach(() => {
        mockAggregation.aggregateByCategory.mockResolvedValue([
          { category_id: 3, name: 'Cuotas', type: 0, total: 500, count: 1 },
          { category_id: 8, name: 'Material', type: 1, total: 120, count: 1 },
        ]);
        mockPrisma.financePeriodClosing.findUnique.mockResolvedValue(null);
      });

      it('returns a PDF buffer with ASCII filename, disposition and no-store', async () => {
        mockAggregation.resolveClubScope.mockResolvedValue({
          ...scope,
          club: { club_id: 1, name: 'Águilas del Ñandú' },
        });

        const file = await service.buildExport(1, {
          year: 2026,
          month: 9,
          format: 'pdf',
        });

        expect(file.buffer.subarray(0, 4).toString()).toBe('%PDF');
        expect(file.contentType).toBe('application/pdf');
        expect(file.filename).toBe('finanzas-Aguilas-del-Nandu-2026-09.pdf');
        expect(file.filename).toMatch(/^[\x20-\x7e]+$/);
        expect(file.contentDisposition).toBe(
          'attachment; filename="finanzas-Aguilas-del-Nandu-2026-09.pdf"; filename*=UTF-8\'\'finanzas-Aguilas-del-Nandu-2026-09.pdf',
        );
        expect(file.cacheControl).toBe('no-store');
      });

      it('names a whole-year pdf with the year only', async () => {
        const file = await service.buildExport(1, {
          year: 2026,
          format: 'pdf',
        });

        expect(file.filename).toBe('finanzas-Club-Panteras-2026.pdf');
        expect(
          mockPrisma.financePeriodClosing.findUnique,
        ).not.toHaveBeenCalled();
      });

      it('reuses scope resolution, the same movement query and the row cap', async () => {
        await service.buildExport(
          1,
          { year: 2026, club_section_id: 10, format: 'pdf' },
          10,
        );

        expect(mockAggregation.resolveClubScope).toHaveBeenCalledWith(
          1,
          10,
          10,
        );
        const args = mockPrisma.finances.findMany.mock.calls[0][0];
        expect(args.take).toBe(FINANCE_EXPORT_MAX_ROWS);
        expect(args.where).toMatchObject({
          active: true,
          year: 2026,
          club_section_id: { in: [10, 11] },
        });
      });

      it('does not render when the scope is forbidden', async () => {
        mockAggregation.resolveClubScope.mockRejectedValueOnce({
          code: ErrorCode.GUARD_PERMISSION_DENIED,
        });

        await expect(
          service.buildExport(
            1,
            { year: 2026, club_section_id: 11, format: 'pdf' },
            10,
          ),
        ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
        expect(mockPrisma.finances.findMany).not.toHaveBeenCalled();
      });

      describe('model handed to the renderer', () => {
        const closedAt = new Date('2026-10-01T18:00:00Z');
        let render: jest.SpyInstance;
        beforeEach(() => {
          render = jest
            .spyOn(pdfModule, 'renderFinanceExportPdf')
            .mockResolvedValue(Buffer.from('%PDF'));
          mockPrisma.financePeriodClosing.findUnique.mockResolvedValue({
            finance_period_closing_id: 5,
            closed_at: closedAt,
          });
          mockResponsibles.forSections.mockResolvedValue(
            new Map([
              [10, { director: 'Ana Ruiz', treasurer: 'Luis Paz' }],
              [11, { director: null, treasurer: null }],
            ]),
          );
        });
        afterEach(() => render.mockRestore());

        const requester = {
          userId: 'u-1',
          authorization: {
            grants: { global_roles: [{ role_name: 'admin' }] },
            effective: { scope: { club: null } },
          } as any,
        };

        it('carries the local field, closing date, responsibles and requester', async () => {
          await service.buildExport(
            1,
            { year: 2026, month: 9, format: 'pdf' },
            null,
            requester,
          );

          const model = render.mock.calls[0][0];
          expect(model).toMatchObject({
            localFieldName: 'Asociación Centro',
            year: 2026,
            month: 9,
            monthClosed: true,
            closedAt,
            generatedBy: { name: 'Admin SACDIA', roleLabel: 'Administrador' },
            responsibles: [
              {
                sectionName: 'Aventureros',
                director: 'Ana Ruiz',
                treasurer: 'Luis Paz',
              },
              {
                sectionName: 'Conquistadores',
                director: null,
                treasurer: null,
              },
            ],
          });
          expect(mockResponsibles.forSections).toHaveBeenCalledWith(
            1,
            [10, 11],
          );
          expect(mockPrisma.users.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { user_id: 'u-1' } }),
          );
        });

        it('leaves the attribution out without a requester and tolerates no local field', async () => {
          mockPrisma.clubs.findUnique.mockResolvedValue({ local_fields: null });

          await service.buildExport(1, { year: 2026, format: 'pdf' });

          const model = render.mock.calls[0][0];
          expect(model.generatedBy).toBeNull();
          expect(model.localFieldName).toBeNull();
          expect(model.monthClosed).toBe(false);
          expect(mockPrisma.users.findUnique).not.toHaveBeenCalled();
        });

        it('only lists the filtered section', async () => {
          await service.buildExport(
            1,
            { year: 2026, club_section_id: 10, format: 'pdf' },
            10,
          );
          const model = render.mock.calls[0][0];
          expect(model.sectionFiltered).toBe(true);
        });
      });

      it('looks up the month closing and renders a closed month', async () => {
        mockPrisma.financePeriodClosing.findUnique.mockResolvedValue({
          finance_period_closing_id: 5,
          closed_at: new Date('2026-04-01T18:00:00Z'),
        });

        const file = await service.buildExport(1, {
          year: 2026,
          month: 3,
          format: 'pdf',
        });

        expect(mockPrisma.financePeriodClosing.findUnique).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              club_id_year_month: { club_id: 1, year: 2026, month: 3 },
            },
          }),
        );
        expect(file.buffer.subarray(0, 4).toString()).toBe('%PDF');
      });
    });
  });

  describe('getOverview', () => {
    const clubs = [
      {
        club_id: 5,
        name: 'Alfa',
        local_fields: { local_field_id: 7, name: 'Campo 7' },
      },
      {
        club_id: 6,
        name: 'Beta',
        local_fields: { local_field_id: 7, name: 'Campo 7' },
      },
      { club_id: 7, name: 'Gamma', local_fields: null },
    ];
    const totals = (
      club_id: number,
      income: number,
      expenses: number,
      balance: number,
      movements: number,
    ) => ({
      club_id,
      income,
      expenses,
      net: income - expenses,
      balance,
      movements,
      last_movement_at: new Date('2026-04-20T10:00:00Z'),
    });

    beforeEach(() => {
      mockPrisma.clubs.findMany.mockResolvedValue(clubs);
      mockAggregation.aggregateByClub.mockResolvedValue(
        new Map([
          [5, totals(5, 1000, 400, 2600, 4)],
          [6, totals(6, 200, 50, 150, 1)],
        ]),
      );
      mockScore.getMonthsStatus.mockImplementation(async (id: number) => ({
        monthsWithMovements: [1, 2],
        missedMonths: id === 5 ? [3] : [3, 4],
      }));
    });

    it('lists the clubs of a Local Field limited to its territory, with totals', async () => {
      mockAuth.resolveUserAuthorization.mockResolvedValue(
        profile([{ role: 'director-lf' }], { localFieldId: 7 }),
      );

      const result = await service.getOverview('lf-user', { year: 2026 });

      const where = mockPrisma.clubs.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        active: true,
        AND: [{ local_field_id: 7 }],
      });
      expect(result.period).toBe('2026');
      expect(result.data[0]).toEqual({
        club_id: 5,
        club_name: 'Alfa',
        local_field: { local_field_id: 7, name: 'Campo 7' },
        income: 1000,
        expenses: 400,
        net: 600,
        balance: 2600,
        movements: 4,
        months_without_movements: 1,
        missed_months: [3],
        last_movement_at: new Date('2026-04-20T10:00:00Z'),
      });
      // A club with no movements still shows up, in zeros, with no last movement.
      expect(result.data[2]).toMatchObject({
        club_id: 7,
        local_field: null,
        income: 0,
        balance: 0,
        movements: 0,
        last_movement_at: null,
      });
      expect(result.totals).toEqual({
        income: 1200,
        expenses: 450,
        net: 750,
        balance: 2750,
        movements: 5,
      });
      expect(result.meta).toMatchObject({ page: 1, limit: 100, total: 3 });
    });

    it('reuses FinanceScoreService.getMonthsStatus for the requested year', async () => {
      mockAuth.resolveUserAuthorization.mockResolvedValue(
        profile([{ role: 'director-lf' }], { localFieldId: 7 }),
      );

      await service.getOverview('lf-user', { year: 2026 });

      expect(mockScore.getMonthsStatus).toHaveBeenCalledWith(5, 2026);
      expect(mockScore.getMonthsStatus).toHaveBeenCalledWith(6, 2026);
      expect(mockScore.getMonthsStatus).toHaveBeenCalledWith(7, 2026);
    });

    it('a month narrows the totals to that month', async () => {
      mockAuth.resolveUserAuthorization.mockResolvedValue(
        profile([{ role: 'director-lf' }], { localFieldId: 7 }),
      );

      const result = await service.getOverview('lf-user', {
        year: 2026,
        month: 3,
      });

      expect(mockAggregation.aggregateByClub).toHaveBeenCalledWith([5, 6, 7], {
        from: { year: 2026, month: 3 },
        to: { year: 2026, month: 3 },
      });
      expect(result.period).toBe('2026-03');
    });

    it('a local_field_id outside the territory is ANDed with it (matches nothing)', async () => {
      mockAuth.resolveUserAuthorization.mockResolvedValue(
        profile([{ role: 'director-lf' }], { localFieldId: 7 }),
      );

      await service.getOverview('lf-user', { year: 2026, local_field_id: 99 });

      expect(mockPrisma.clubs.findMany.mock.calls[0][0].where.AND).toEqual([
        { local_field_id: 7 },
        { local_field_id: 99 },
      ]);
    });

    it('a union role sees the clubs of its union', async () => {
      mockAuth.resolveUserAuthorization.mockResolvedValue(
        profile([{ role: 'director-union' }], { unionId: 3 }),
      );

      await service.getOverview('union-user', { year: 2026 });

      expect(mockPrisma.clubs.findMany.mock.calls[0][0].where.AND[0]).toEqual({
        local_fields: { union_id: 3 },
      });
    });

    it('super-admin sees every club (no territory filter)', async () => {
      mockAuth.resolveUserAuthorization.mockResolvedValue(
        profile([{ role: 'super-admin' }]),
      );

      await service.getOverview('root', { year: 2026, local_field_id: 7 });

      expect(mockPrisma.clubs.findMany.mock.calls[0][0].where.AND).toEqual([
        {},
        { local_field_id: 7 },
      ]);
    });

    it('403 for a caller without a global role that carries finances:read (club treasurer)', async () => {
      mockAuth.resolveUserAuthorization.mockResolvedValue(
        profile([{ role: 'user', permissions: ['finances:read'] }]),
      );

      await expect(
        service.getOverview('treasurer', { year: 2026 }),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
      expect(mockPrisma.clubs.findMany).not.toHaveBeenCalled();
    });

    it('403 when the global role does not carry finances:read', async () => {
      mockAuth.resolveUserAuthorization.mockResolvedValue(
        profile([{ role: 'director-lf', permissions: ['reports:read'] }], {
          localFieldId: 7,
        }),
      );

      await expect(
        service.getOverview('lf-user', { year: 2026 }),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });
    });

    it('rejects a territorial role without territory configured', async () => {
      mockAuth.resolveUserAuthorization.mockResolvedValue(
        profile([{ role: 'director-lf' }]),
      );

      await expect(
        service.getOverview('lf-user', { year: 2026 }),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
    });

    it('paginates the clubs but totals cover all of them', async () => {
      mockAuth.resolveUserAuthorization.mockResolvedValue(
        profile([{ role: 'director-lf' }], { localFieldId: 7 }),
      );

      const result = await service.getOverview('lf-user', {
        year: 2026,
        page: 2,
        limit: 2,
      });

      expect(result.data.map((c) => c.club_id)).toEqual([7]);
      expect(result.meta).toEqual({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(result.totals.income).toBe(1200);
      expect(mockScore.getMonthsStatus).toHaveBeenCalledTimes(1);
    });
  });
});
