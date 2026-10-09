import { Test, TestingModule } from '@nestjs/testing';
import { AppForbiddenException } from '../common/errors/app.exception';
import { InvestitureService } from './investiture.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';

describe('InvestitureService', () => {
  let service: InvestitureService;

  // ---- transaction mock helpers ----

  const createTxMock = () => ({
    $executeRaw: jest.fn().mockResolvedValue(0),
    enrollments: {
      update: jest.fn().mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'SUBMITTED_FOR_VALIDATION',
        submitted_at: new Date('2026-06-01T00:00:00.000Z'),
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    investiture_authorization_people: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    investiture_validation_history: {
      create: jest.fn().mockResolvedValue({ history_id: 1 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  });

  let txMock: ReturnType<typeof createTxMock>;

  const mockPrismaService = {
    $transaction: jest.fn(),
    enrollments: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    ecclesiastical_years: {
      findFirst: jest.fn(),
      count: jest.fn(),
    },
    investiture_config: {
      findFirst: jest.fn(),
    },
    investiture_validation_history: {
      findMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
    },
    users: {
      findUnique: jest.fn(),
    },
    club_role_assignments: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const mockAuthorizationContext = {
    hasAnyGlobalRole: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    txMock = createTxMock();
    txMock.enrollments.findUnique.mockImplementation(async () => {
      const calls = txMock.enrollments.updateMany.mock.calls;
      const last = calls[calls.length - 1]?.[0] as
        { data?: Record<string, unknown> } | undefined;
      return {
        enrollment_id: 1,
        investiture_status:
          last?.data?.investiture_status ?? 'SUBMITTED_FOR_VALIDATION',
        submitted_at:
          last?.data?.submitted_at ?? new Date('2026-06-01T00:00:00.000Z'),
        rejection_reason: last?.data?.rejection_reason ?? null,
        validated_by: last?.data?.validated_by ?? null,
        validated_at: last?.data?.validated_at ?? null,
      };
    });

    // Default: interactive $transaction calls the callback with txMock
    // Array form: resolve each element (Prisma query builders behave like thenables)
    mockPrismaService.$transaction.mockImplementation((arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: typeof txMock) => Promise<unknown>)(txMock);
      }
      return Promise.all(arg as Array<Promise<unknown>>);
    });

    // Default return values for direct prisma model calls used in array-form transactions
    mockPrismaService.enrollments.update.mockResolvedValue({
      enrollment_id: 1,
      investiture_status: 'SUBMITTED_FOR_VALIDATION',
      submitted_at: new Date(),
    });
    mockPrismaService.investiture_validation_history.create.mockResolvedValue({
      history_id: 1,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvestitureService,
        { provide: PrismaService, useValue: mockPrismaService },
        {
          provide: AuthorizationContextService,
          useValue: mockAuthorizationContext,
        },
      ],
    }).compile();

    service = module.get<InvestitureService>(InvestitureService);
  });

  it('keeps only the history read and the overdue expiry', () => {
    expect(
      Object.getOwnPropertyNames(InvestitureService.prototype).sort(),
    ).toEqual([
      'constructor',
      'countElapsedEcclesiasticalYears',
      'expireOverdueEnrollments',
      'findCurrentEcclesiasticalYear',
      'getHistory',
    ]);
  });

  // ============================================================
  // getHistory
  // ============================================================

  describe('getHistory', () => {
    const historyEntries = [
      {
        history_id: 1,
        action: 'SUBMITTED',
        performed_by: 'user-abc',
        comments: null,
        created_at: new Date('2026-03-01'),
        users: { name: 'Juan', paternal_last_name: 'Garcia' },
      },
      {
        history_id: 2,
        action: 'CLUB_APPROVED',
        performed_by: 'director-123',
        comments: 'Todo correcto',
        created_at: new Date('2026-03-02'),
        users: { name: 'Director', paternal_last_name: 'Garcia' },
      },
      {
        history_id: 3,
        action: 'COORDINATOR_APPROVED',
        performed_by: 'coordinator-456',
        comments: 'Validado',
        created_at: new Date('2026-03-03'),
        users: { name: 'Coordinador', paternal_last_name: 'Lopez' },
      },
    ];

    const enrollmentRecord = { enrollment_id: 1, user_id: 'user-abc' };

    it('TC37 - happy path: admin gets full multi-level history', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue(
        enrollmentRecord,
      );
      mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValue(true);
      mockPrismaService.investiture_validation_history.findMany.mockResolvedValue(
        historyEntries,
      );

      const result = await service.getHistory(1, 'admin-xyz');

      expect(result.enrollment_id).toBe(1);
      expect(result.history).toHaveLength(3);
      expect(result.history[0].action).toBe('SUBMITTED');
      expect(result.history[1].action).toBe('CLUB_APPROVED');
      expect(result.history[2].action).toBe('COORDINATOR_APPROVED');
    });

    it('TC38 - happy path: enrollment owner gets own history', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue(
        enrollmentRecord,
      );
      mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValue(false);
      // No club sections found -> falls through to owner check
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([]);
      mockPrismaService.investiture_validation_history.findMany.mockResolvedValue(
        historyEntries,
      );

      // actor IS the enrollment owner
      const result = await service.getHistory(1, 'user-abc');

      expect(result.enrollment_id).toBe(1);
      expect(result.history).toHaveLength(3);
    });

    it('TC39 - error: non-owner non-admin -> ForbiddenException', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue(
        enrollmentRecord,
      );
      mockAuthorizationContext.hasAnyGlobalRole.mockResolvedValue(false);
      // No club sections found -> falls through to owner check -> actor is not owner
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([]);

      // actor is neither owner nor admin
      await expect(service.getHistory(1, 'other-user')).rejects.toThrow(
        AppForbiddenException,
      );
    });
  });

  describe('expireOverdueEnrollments', () => {
    it('supports dry-run and excludes invested or in-pipeline enrollments', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
        start_date: new Date('2026-01-01'),
      });
      mockPrismaService.ecclesiastical_years.count
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(1);
      mockPrismaService.enrollments.findMany.mockResolvedValue([
        {
          enrollment_id: 1,
          investiture_status: 'IN_PROGRESS',
          ecclesiastical_year: { start_date: new Date('2025-01-01') },
          classes: { max_duration_years: 1 },
        },
        {
          enrollment_id: 2,
          investiture_status: 'REJECTED',
          ecclesiastical_year: { start_date: new Date('2026-01-01') },
          classes: { max_duration_years: 1 },
        },
      ]);

      const result = await service.expireOverdueEnrollments('admin-1', {
        ecclesiastical_year_id: 2026,
        dry_run: true,
      });

      expect(mockPrismaService.enrollments.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            active: true,
            record_kind: 'OPERATIONAL',
            investiture_status: { in: ['IN_PROGRESS', 'REJECTED'] },
          }),
        }),
      );
      expect(result).toMatchObject({
        ecclesiastical_year_id: 2026,
        dry_run: true,
        scanned_count: 2,
        expired_count: 1,
        enrollment_ids: [1],
      });
      expect(mockPrismaService.enrollments.updateMany).not.toHaveBeenCalled();
      expect(
        mockPrismaService.investiture_validation_history.createMany,
      ).not.toHaveBeenCalled();
    });

    it('does not select or expire HISTORICAL_CERTIFICATE INVESTIDO enrollments', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
        start_date: new Date('2026-01-01'),
      });
      mockPrismaService.enrollments.findMany.mockResolvedValue([]);

      const result = await service.expireOverdueEnrollments('admin-1', {
        ecclesiastical_year_id: 2026,
        dry_run: false,
      });

      expect(mockPrismaService.enrollments.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            active: true,
            record_kind: 'OPERATIONAL',
            investiture_status: { in: ['IN_PROGRESS', 'REJECTED'] },
          }),
        }),
      );
      const candidateWhere =
        mockPrismaService.enrollments.findMany.mock.calls[0][0].where;
      expect(candidateWhere.record_kind).toBe('OPERATIONAL');
      expect(candidateWhere.investiture_status.in).not.toContain('INVESTIDO');
      expect(result).toMatchObject({
        scanned_count: 0,
        expired_count: 0,
        enrollment_ids: [],
      });
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
      expect(mockPrismaService.enrollments.updateMany).not.toHaveBeenCalled();
    });

    it('expires overdue enrollments and writes EXPIRED audit rows', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
        start_date: new Date('2026-01-01'),
      });
      mockPrismaService.ecclesiastical_years.count.mockResolvedValue(3);
      mockPrismaService.enrollments.findMany.mockResolvedValue([
        {
          enrollment_id: 11,
          investiture_status: 'REJECTED',
          ecclesiastical_year: { start_date: new Date('2024-01-01') },
          classes: { max_duration_years: 2 },
        },
      ]);
      txMock.enrollments.findMany.mockResolvedValue([{ enrollment_id: 11 }]);
      txMock.enrollments.updateMany.mockResolvedValue({ count: 1 });
      txMock.investiture_validation_history.createMany.mockResolvedValue({
        count: 1,
      });

      const result = await service.expireOverdueEnrollments('admin-1', {
        ecclesiastical_year_id: 2026,
        dry_run: false,
      });

      expect(result.expired_count).toBe(1);
      expect(txMock.enrollments.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            enrollment_id: { in: [11] },
            record_kind: 'OPERATIONAL',
          }),
          data: expect.objectContaining({ investiture_status: 'EXPIRED' }),
        }),
      );
      expect(
        txMock.investiture_validation_history.createMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              enrollment_id: 11,
              action: 'EXPIRED',
              performed_by: 'admin-1',
            }),
          ],
        }),
      );
    });

    it('revalidates overdue enrollments inside the transaction before writing audit rows', async () => {
      mockPrismaService.ecclesiastical_years.count.mockReset();
      mockPrismaService.enrollments.findMany.mockReset();
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
        start_date: new Date('2026-01-01'),
      });
      mockPrismaService.ecclesiastical_years.count.mockResolvedValue(3);
      mockPrismaService.enrollments.findMany.mockResolvedValue([
        {
          enrollment_id: 11,
          investiture_status: 'REJECTED',
          ecclesiastical_year: { start_date: new Date('2024-01-01') },
          classes: { max_duration_years: 2 },
        },
        {
          enrollment_id: 12,
          investiture_status: 'IN_PROGRESS',
          ecclesiastical_year: { start_date: new Date('2024-01-01') },
          classes: { max_duration_years: 0 },
        },
      ]);
      txMock.enrollments.findMany.mockResolvedValue([{ enrollment_id: 11 }]);
      txMock.enrollments.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.expireOverdueEnrollments('admin-1', {
        ecclesiastical_year_id: 2026,
        dry_run: false,
      });

      expect(txMock.enrollments.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            enrollment_id: { in: [11, 12] },
            active: true,
            investiture_status: { in: ['IN_PROGRESS', 'REJECTED'] },
          }),
          select: { enrollment_id: true },
        }),
      );
      expect(result).toMatchObject({
        expired_count: 1,
        enrollment_ids: [11],
      });
      expect(
        txMock.investiture_validation_history.createMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              enrollment_id: 11,
              action: 'EXPIRED',
            }),
          ],
        }),
      );
    });

    it('does not expire an enrollment with a pending request', async () => {
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
        start_date: new Date('2026-01-01'),
      });
      mockPrismaService.ecclesiastical_years.count.mockResolvedValue(3);
      mockPrismaService.enrollments.findMany.mockResolvedValue([
        {
          enrollment_id: 11,
          investiture_status: 'IN_PROGRESS',
          ecclesiastical_year: { start_date: new Date('2024-01-01') },
          classes: { max_duration_years: 2 },
        },
      ]);
      txMock.enrollments.findMany.mockResolvedValue([{ enrollment_id: 11 }]);
      txMock.investiture_authorization_people.findFirst.mockResolvedValue({
        person_id: 'person-1',
      });

      const result = await service.expireOverdueEnrollments('admin-1', {
        ecclesiastical_year_id: 2026,
      });

      expect(result.expired_count).toBe(0);
      expect(result.enrollment_ids).toEqual([]);
      expect(txMock.enrollments.updateMany).not.toHaveBeenCalled();
    });
  });
});
