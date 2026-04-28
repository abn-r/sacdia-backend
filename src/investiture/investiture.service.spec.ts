import { Test, TestingModule } from '@nestjs/testing';
import { ErrorCode } from '../common/errors/error-codes';
import { AchievementsService } from '../achievements/achievements.service';
import { InvestitureService } from './investiture.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SubmitForValidationDto } from './dto/submit-for-validation.dto';
import {
  ValidateEnrollmentDto,
  InvestitureValidationAction,
} from './dto/validate-enrollment.dto';
import { MarkInvestidoDto } from './dto/mark-investido.dto';
import { ApproveInvestitureDto } from './dto/approve-investiture.dto';
import { RejectInvestitureDto } from './dto/reject-investiture.dto';

describe('InvestitureService', () => {
  let service: InvestitureService;

  // ---- transaction mock helpers ----

  const createTxMock = () => ({
    enrollments: {
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn(),
    },
    investiture_validation_history: {
      create: jest.fn(),
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
    },
    investiture_config: {
      findFirst: jest.fn(),
    },
    investiture_validation_history: {
      findMany: jest.fn(),
      create: jest.fn(),
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

  const mockNotificationsService = {
    sendToSectionRole: jest.fn().mockResolvedValue(undefined),
    sendToGlobalRole: jest.fn().mockResolvedValue(undefined),
    notifySafe: jest.fn().mockResolvedValue(undefined),
  };

  // ---- shared fixtures ----

  const pastDate = new Date('2024-01-01T00:00:00.000Z');
  const futureDate = new Date('2099-12-31T00:00:00.000Z');

  const baseEnrollment = {
    enrollment_id: 1,
    user_id: 'user-abc',
    class_id: 7,
    ecclesiastical_year_id: 2026,
    investiture_status: 'IN_PROGRESS',
    locked_for_validation: false,
    active: true,
    users: { local_field_id: 3 },
  };

  const baseConfig = {
    config_id: 10,
    local_field_id: 3,
    ecclesiastical_year_id: 2026,
    submission_deadline: futureDate,
    investiture_date: new Date('2026-06-01'),
    active: true,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    txMock = createTxMock();

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
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
        {
          provide: AchievementsService,
          useValue: {
            emitEvent: jest
              .fn()
              .mockResolvedValue({ eventLogId: 1, queued: true }),
          },
        },
      ],
    }).compile();

    service = module.get<InvestitureService>(InvestitureService);
  });

  // ============================================================
  // submitForValidation
  // ============================================================

  describe('submitForValidation', () => {
    const dto: SubmitForValidationDto = { club_id: 1, comments: 'Todo listo' };

    it('TC01 - happy path: IN_PROGRESS -> SUBMITTED_FOR_VALIDATION', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue({
        ...baseEnrollment,
        investiture_status: 'IN_PROGRESS',
      });
      mockPrismaService.investiture_config.findFirst.mockResolvedValue(
        baseConfig,
      );

      const result = await service.submitForValidation(1, 'user-abc', dto);

      expect(result.investiture_status).toBe('SUBMITTED_FOR_VALIDATION');
      expect(result.is_late).toBe(false);
      expect(result.enrollment_id).toBe(1);
    });

    it('TC02 - happy path: REJECTED -> SUBMITTED_FOR_VALIDATION (re-submit)', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue({
        ...baseEnrollment,
        investiture_status: 'REJECTED',
      });
      mockPrismaService.investiture_config.findFirst.mockResolvedValue(
        baseConfig,
      );

      const result = await service.submitForValidation(1, 'user-abc', dto);

      expect(result.investiture_status).toBe('SUBMITTED_FOR_VALIDATION');
      expect(result.is_late).toBe(false);
    });

    it('TC03 - error: enrollment not found -> NotFoundException', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue(null);

      await expect(
        service.submitForValidation(999, 'user-abc', dto),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_ENROLLMENT_NOT_FOUND,
      });
    });

    it('TC04 - error: enrollment inactive -> NotFoundException', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue({
        ...baseEnrollment,
        active: false,
      });

      await expect(
        service.submitForValidation(1, 'user-abc', dto),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_ENROLLMENT_NOT_FOUND,
      });
    });

    it('TC05 - error: wrong state (CLUB_APPROVED) -> BadRequestException', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue({
        ...baseEnrollment,
        investiture_status: 'CLUB_APPROVED',
      });

      await expect(
        service.submitForValidation(1, 'user-abc', dto),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_INVALID_STATE_TRANSITION,
      });
    });

    it('TC06 - error: no investiture_config -> NotFoundException', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue({
        ...baseEnrollment,
        investiture_status: 'IN_PROGRESS',
      });
      mockPrismaService.investiture_config.findFirst.mockResolvedValue(null);

      await expect(
        service.submitForValidation(1, 'user-abc', dto),
      ).rejects.toMatchObject({ code: ErrorCode.INVESTITURE_CONFIG_NOT_FOUND });
    });

    it('TC07 - soft deadline: past deadline returns is_late=true but succeeds', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue({
        ...baseEnrollment,
        investiture_status: 'IN_PROGRESS',
      });
      mockPrismaService.investiture_config.findFirst.mockResolvedValue({
        ...baseConfig,
        submission_deadline: pastDate,
      });

      const result = await service.submitForValidation(1, 'user-abc', dto);

      expect(result.is_late).toBe(true);
      expect(result.investiture_status).toBe('SUBMITTED_FOR_VALIDATION');
    });
  });

  // ============================================================
  // clubApprove
  // ============================================================

  describe('clubApprove', () => {
    const dto: ApproveInvestitureDto = { comments: 'Todo correcto' };

    it('TC08 - happy path: SUBMITTED_FOR_VALIDATION -> CLUB_APPROVED', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'SUBMITTED_FOR_VALIDATION',
        user_id: 'user-abc',
        users: { local_field_id: 3 },
      });
      txMock.enrollments.updateMany.mockResolvedValue({ count: 1 });
      txMock.enrollments.findUnique.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'CLUB_APPROVED',
      });
      txMock.investiture_validation_history.create.mockResolvedValue({});

      const result = await service.clubApprove(1, 'director-123', dto);

      expect(result.investiture_status).toBe('CLUB_APPROVED');
      expect(result.approved_by).toBe('director-123');
    });

    it('TC09 - error: wrong state (IN_PROGRESS) -> ConflictException', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'IN_PROGRESS',
      });

      await expect(
        service.clubApprove(1, 'director-123', dto),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_INVALID_STATE_TRANSITION,
      });
    });

    it('TC10 - error: enrollment not found -> NotFoundException', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue(null);

      await expect(
        service.clubApprove(999, 'director-123', dto),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_ENROLLMENT_NOT_FOUND,
      });
    });
  });

  // ============================================================
  // coordinatorApprove
  // ============================================================

  describe('coordinatorApprove', () => {
    const dto: ApproveInvestitureDto = {
      comments: 'Validado por coordinacion',
    };

    it('TC11 - happy path: CLUB_APPROVED -> COORDINATOR_APPROVED', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'CLUB_APPROVED',
        user_id: 'user-abc',
        users: { local_field_id: 3 },
      });
      txMock.enrollments.updateMany.mockResolvedValue({ count: 1 });
      txMock.enrollments.findUnique.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'COORDINATOR_APPROVED',
      });
      txMock.investiture_validation_history.create.mockResolvedValue({});

      const result = await service.coordinatorApprove(
        1,
        'coordinator-456',
        dto,
      );

      expect(result.investiture_status).toBe('COORDINATOR_APPROVED');
      expect(result.approved_by).toBe('coordinator-456');
    });

    it('TC12 - error: wrong state (SUBMITTED_FOR_VALIDATION) -> ConflictException', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'SUBMITTED_FOR_VALIDATION',
      });

      await expect(
        service.coordinatorApprove(1, 'coordinator-456', dto),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_INVALID_STATE_TRANSITION,
      });
    });
  });

  // ============================================================
  // fieldApprove
  // ============================================================

  describe('fieldApprove', () => {
    const dto: ApproveInvestitureDto = {
      comments: 'Autorizado por campo local',
    };

    it('TC13 - happy path: COORDINATOR_APPROVED -> FIELD_APPROVED', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'COORDINATOR_APPROVED',
        user_id: 'user-abc',
        users: { local_field_id: 3 },
      });
      txMock.enrollments.updateMany.mockResolvedValue({ count: 1 });
      txMock.enrollments.findUnique.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'FIELD_APPROVED',
      });
      txMock.investiture_validation_history.create.mockResolvedValue({});

      const result = await service.fieldApprove(1, 'field-admin-789', dto);

      expect(result.investiture_status).toBe('FIELD_APPROVED');
      expect(result.approved_by).toBe('field-admin-789');
    });

    it('TC14 - error: wrong state (CLUB_APPROVED) -> ConflictException', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'CLUB_APPROVED',
      });

      await expect(
        service.fieldApprove(1, 'field-admin-789', dto),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_INVALID_STATE_TRANSITION,
      });
    });
  });

  // ============================================================
  // reject
  // ============================================================

  describe('reject', () => {
    const dto: RejectInvestitureDto = {
      reason: 'Faltan evidencias del honor de Primeros Auxilios',
    };

    it('TC15 - happy path: reject from SUBMITTED_FOR_VALIDATION', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'SUBMITTED_FOR_VALIDATION',
      });
      txMock.enrollments.update.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'REJECTED',
        rejection_reason: dto.reason,
      });
      txMock.investiture_validation_history.create.mockResolvedValue({});

      const result = await service.reject(1, 'admin-xyz', dto);

      expect(result.investiture_status).toBe('REJECTED');
      expect(result.rejection_reason).toBe(dto.reason);
    });

    it('TC16 - happy path: reject from CLUB_APPROVED', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'CLUB_APPROVED',
      });
      txMock.enrollments.update.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'REJECTED',
        rejection_reason: dto.reason,
      });
      txMock.investiture_validation_history.create.mockResolvedValue({});

      const result = await service.reject(1, 'admin-xyz', dto);

      expect(result.investiture_status).toBe('REJECTED');
    });

    it('TC17 - happy path: reject from COORDINATOR_APPROVED', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'COORDINATOR_APPROVED',
      });
      txMock.enrollments.update.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'REJECTED',
        rejection_reason: dto.reason,
      });
      txMock.investiture_validation_history.create.mockResolvedValue({});

      const result = await service.reject(1, 'admin-xyz', dto);

      expect(result.investiture_status).toBe('REJECTED');
    });

    it('TC18 - happy path: reject from FIELD_APPROVED', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'FIELD_APPROVED',
      });
      txMock.enrollments.update.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'REJECTED',
        rejection_reason: dto.reason,
      });
      txMock.investiture_validation_history.create.mockResolvedValue({});

      const result = await service.reject(1, 'admin-xyz', dto);

      expect(result.investiture_status).toBe('REJECTED');
    });

    it('TC19 - error: cannot reject IN_PROGRESS -> BadRequestException', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'IN_PROGRESS',
      });

      await expect(service.reject(1, 'admin-xyz', dto)).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_INVALID_STATE_TRANSITION,
      });
    });

    it('TC20 - error: cannot reject INVESTIDO -> BadRequestException', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'INVESTIDO',
      });

      await expect(service.reject(1, 'admin-xyz', dto)).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_INVALID_STATE_TRANSITION,
      });
    });

    it('TC21 - error: enrollment not found -> NotFoundException', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue(null);

      await expect(service.reject(999, 'admin-xyz', dto)).rejects.toMatchObject(
        { code: ErrorCode.INVESTITURE_ENROLLMENT_NOT_FOUND },
      );
    });

    it('TC22 - verify: rejection unlocks enrollment', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'SUBMITTED_FOR_VALIDATION',
      });
      txMock.enrollments.update.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'REJECTED',
        rejection_reason: dto.reason,
        locked_for_validation: false,
        submitted_for_validation: false,
      });
      txMock.investiture_validation_history.create.mockResolvedValue({});

      await service.reject(1, 'admin-xyz', dto);

      const updateCall = txMock.enrollments.update.mock.calls[0][0] as {
        data: {
          locked_for_validation: boolean;
          submitted_for_validation: boolean;
        };
      };
      expect(updateCall.data.locked_for_validation).toBe(false);
      expect(updateCall.data.submitted_for_validation).toBe(false);
    });
  });

  // ============================================================
  // markInvestido
  // ============================================================

  describe('markInvestido', () => {
    const fieldApprovedEnrollment = {
      ...baseEnrollment,
      investiture_status: 'FIELD_APPROVED',
    };

    const investidoResult = {
      enrollment_id: 1,
      investiture_status: 'INVESTIDO',
      investiture_date: baseConfig.investiture_date,
    };

    const dto: MarkInvestidoDto = { comments: 'Investidura primavera 2026' };

    it('TC23 - happy path: FIELD_APPROVED -> INVESTIDO', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue(
        fieldApprovedEnrollment,
      );
      mockPrismaService.investiture_config.findFirst.mockResolvedValue(
        baseConfig,
      );
      txMock.enrollments.update.mockResolvedValue(investidoResult);
      txMock.investiture_validation_history.create.mockResolvedValue({});

      const result = await service.markInvestido(1, 'admin-xyz', dto);

      expect(result.investiture_status).toBe('INVESTIDO');
      expect(result.investiture_date).toEqual(baseConfig.investiture_date);
    });

    it('TC24 - error: enrollment not found -> NotFoundException', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue(null);

      await expect(
        service.markInvestido(999, 'admin-xyz', dto),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_ENROLLMENT_NOT_FOUND,
      });
    });

    it('TC25 - error: already INVESTIDO -> ConflictException', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue({
        ...baseEnrollment,
        investiture_status: 'INVESTIDO',
      });

      await expect(
        service.markInvestido(1, 'admin-xyz', dto),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_ALREADY_INVESTIDO,
      });
    });

    it('TC26 - error: wrong state (SUBMITTED_FOR_VALIDATION) -> BadRequestException', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue({
        ...baseEnrollment,
        investiture_status: 'SUBMITTED_FOR_VALIDATION',
      });

      await expect(
        service.markInvestido(1, 'admin-xyz', dto),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_INVALID_STATE_TRANSITION,
      });
    });

    it('TC27 - error: wrong state (COORDINATOR_APPROVED) -> BadRequestException', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue({
        ...baseEnrollment,
        investiture_status: 'COORDINATOR_APPROVED',
      });

      await expect(
        service.markInvestido(1, 'admin-xyz', dto),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_INVALID_STATE_TRANSITION,
      });
    });

    it('TC28 - error: no investiture_config -> NotFoundException', async () => {
      mockPrismaService.enrollments.findUnique.mockResolvedValue(
        fieldApprovedEnrollment,
      );
      mockPrismaService.investiture_config.findFirst.mockResolvedValue(null);

      await expect(
        service.markInvestido(1, 'admin-xyz', dto),
      ).rejects.toMatchObject({ code: ErrorCode.INVESTITURE_CONFIG_NOT_FOUND });
    });
  });

  // ============================================================
  // validateEnrollment (legacy)
  // ============================================================

  describe('validateEnrollment (legacy)', () => {
    const submittedEnrollment = {
      enrollment_id: 1,
      investiture_status: 'SUBMITTED_FOR_VALIDATION',
    };

    it('TC29 - happy path: APPROVED transitions to CLUB_APPROVED', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue(
        submittedEnrollment,
      );
      txMock.enrollments.update.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'CLUB_APPROVED',
        validated_by: 'admin-xyz',
        validated_at: new Date(),
        rejection_reason: null,
      });
      txMock.investiture_validation_history.create.mockResolvedValue({});

      const dto: ValidateEnrollmentDto = {
        action: InvestitureValidationAction.APPROVED,
      };

      const result = await service.validateEnrollment(1, 'admin-xyz', dto);

      expect(result.investiture_status).toBe('CLUB_APPROVED');
      expect(result.rejection_reason).toBeNull();
    });

    it('TC30 - happy path: REJECTED with comments', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue(
        submittedEnrollment,
      );
      txMock.enrollments.update.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'REJECTED',
        validated_by: 'admin-xyz',
        validated_at: new Date(),
        rejection_reason: 'Falta evidencia',
      });
      txMock.investiture_validation_history.create.mockResolvedValue({});

      const dto: ValidateEnrollmentDto = {
        action: InvestitureValidationAction.REJECTED,
        comments: 'Falta evidencia',
      };

      const result = await service.validateEnrollment(1, 'admin-xyz', dto);

      expect(result.investiture_status).toBe('REJECTED');
      expect(result.rejection_reason).toBe('Falta evidencia');
    });

    it('TC31 - error: enrollment not found -> NotFoundException', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue(null);

      const dto: ValidateEnrollmentDto = {
        action: InvestitureValidationAction.APPROVED,
      };

      await expect(
        service.validateEnrollment(999, 'admin-xyz', dto),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_ENROLLMENT_NOT_FOUND,
      });
    });

    it('TC32 - error: wrong state (IN_PROGRESS) -> ConflictException', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'IN_PROGRESS',
      });

      const dto: ValidateEnrollmentDto = {
        action: InvestitureValidationAction.APPROVED,
      };

      await expect(
        service.validateEnrollment(1, 'admin-xyz', dto),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_INVALID_STATE_TRANSITION,
      });
    });

    it('TC33 - error: REJECTED without comments -> BadRequestException', async () => {
      mockPrismaService.enrollments.findFirst.mockResolvedValue(
        submittedEnrollment,
      );

      const dto: ValidateEnrollmentDto = {
        action: InvestitureValidationAction.REJECTED,
        comments: '',
      };

      await expect(
        service.validateEnrollment(1, 'admin-xyz', dto),
      ).rejects.toMatchObject({
        code: ErrorCode.INVESTITURE_REJECT_COMMENTS_REQUIRED,
      });
    });
  });

  // ============================================================
  // getPending
  // ============================================================

  describe('getPending', () => {
    const pendingEnrollments = [
      {
        enrollment_id: 1,
        investiture_status: 'SUBMITTED_FOR_VALIDATION',
        users: {
          name: 'Juan',
          paternal_last_name: 'Garcia',
          maternal_last_name: 'Lopez',
          email: 'juan@example.com',
        },
        classes: { name: 'Conquistador' },
        ecclesiastical_year: {
          start_date: new Date('2026-01-01'),
          end_date: new Date('2026-12-31'),
        },
      },
    ];

    it('TC34 - happy path: returns paginated list filtered by local_field', async () => {
      mockPrismaService.enrollments.findMany.mockResolvedValue(
        pendingEnrollments,
      );
      mockPrismaService.enrollments.count.mockResolvedValue(1);

      const result = await service.getPending('admin-xyz', 3);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(mockPrismaService.users.findUnique).not.toHaveBeenCalled();
    });

    it('TC35 - auto-scoping: resolves actor local_field when not provided', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        local_field_id: 5,
      });
      mockPrismaService.enrollments.findMany.mockResolvedValue(
        pendingEnrollments,
      );
      mockPrismaService.enrollments.count.mockResolvedValue(1);

      const result = await service.getPending('admin-xyz');

      expect(mockPrismaService.users.findUnique).toHaveBeenCalledWith({
        where: { user_id: 'admin-xyz' },
        select: { local_field_id: true },
      });
      expect(result.data).toHaveLength(1);
    });

    it('TC36 - filters by specific status when provided', async () => {
      mockPrismaService.enrollments.findMany.mockResolvedValue(
        pendingEnrollments,
      );
      mockPrismaService.enrollments.count.mockResolvedValue(1);

      await service.getPending(
        'admin-xyz',
        3,
        undefined,
        undefined,
        undefined,
        'CLUB_APPROVED' as any,
      );

      const findManyCall =
        mockPrismaService.enrollments.findMany.mock.calls[0][0];
      expect(findManyCall.where.investiture_status).toEqual({
        in: ['CLUB_APPROVED'],
      });
    });
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
        ForbiddenException,
      );
    });
  });

  // ============================================================
  // Full approval chain integration (end-to-end through service)
  // ============================================================

  describe('Full approval chain', () => {
    it('TC40 - full chain: submit -> club -> coordinator -> field -> invested', async () => {
      // Step 1: Submit
      mockPrismaService.enrollments.findUnique.mockResolvedValue({
        ...baseEnrollment,
        investiture_status: 'IN_PROGRESS',
      });
      mockPrismaService.investiture_config.findFirst.mockResolvedValue(
        baseConfig,
      );

      const submitResult = await service.submitForValidation(
        1,
        'counselor-abc',
        { club_id: 1 },
      );
      expect(submitResult.investiture_status).toBe('SUBMITTED_FOR_VALIDATION');

      // Step 2: Club approve
      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'SUBMITTED_FOR_VALIDATION',
        user_id: 'user-abc',
        users: { local_field_id: 3 },
      });
      txMock.enrollments.updateMany.mockResolvedValue({ count: 1 });
      txMock.enrollments.findUnique.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'CLUB_APPROVED',
      });
      txMock.investiture_validation_history.create.mockResolvedValue({});

      const clubResult = await service.clubApprove(1, 'director-123', {});
      expect(clubResult.investiture_status).toBe('CLUB_APPROVED');

      // Step 3: Coordinator approve
      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'CLUB_APPROVED',
        user_id: 'user-abc',
        users: { local_field_id: 3 },
      });
      txMock.enrollments.updateMany.mockResolvedValue({ count: 1 });
      txMock.enrollments.findUnique.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'COORDINATOR_APPROVED',
      });

      const coordResult = await service.coordinatorApprove(
        1,
        'coordinator-456',
        {},
      );
      expect(coordResult.investiture_status).toBe('COORDINATOR_APPROVED');

      // Step 4: Field approve
      mockPrismaService.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'COORDINATOR_APPROVED',
        user_id: 'user-abc',
        users: { local_field_id: 3 },
      });
      txMock.enrollments.updateMany.mockResolvedValue({ count: 1 });
      txMock.enrollments.findUnique.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'FIELD_APPROVED',
      });

      const fieldResult = await service.fieldApprove(1, 'field-admin-789', {});
      expect(fieldResult.investiture_status).toBe('FIELD_APPROVED');

      // Step 5: Mark invested
      mockPrismaService.enrollments.findUnique.mockResolvedValue({
        ...baseEnrollment,
        investiture_status: 'FIELD_APPROVED',
      });
      mockPrismaService.investiture_config.findFirst.mockResolvedValue(
        baseConfig,
      );
      txMock.enrollments.update.mockResolvedValue({
        enrollment_id: 1,
        investiture_status: 'INVESTIDO',
        investiture_date: baseConfig.investiture_date,
      });

      const investResult = await service.markInvestido(1, 'admin-xyz', {});
      expect(investResult.investiture_status).toBe('INVESTIDO');
    });
  });
});
