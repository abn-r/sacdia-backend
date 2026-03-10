import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PostRegistrationService } from './post-registration.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LegalRepresentativesService } from '../legal-representatives/legal-representatives.service';

describe('PostRegistrationService', () => {
  let service: PostRegistrationService;

  const createTransactionMock = () => ({
    users: { update: jest.fn().mockResolvedValue({}) },
    ecclesiastical_years: {
      findFirst: jest.fn().mockResolvedValue({ year_id: 2026 }),
    },
    roles: {
      findFirst: jest.fn().mockResolvedValue({ role_id: 'role-member' }),
    },
    club_adventurers: {
      findUnique: jest.fn().mockResolvedValue({ club_adv_id: 10 }),
    },
    club_pathfinders: {
      findUnique: jest.fn().mockResolvedValue({ club_pathf_id: 20 }),
    },
    club_master_guilds: {
      findUnique: jest.fn().mockResolvedValue({ club_mg_id: 30 }),
    },
    club_role_assignments: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ assignment_id: 'assignment-1' }),
    },
    classes: {
      findUnique: jest.fn().mockResolvedValue({ class_id: 5, active: true }),
    },
    users_classes: {
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({ user_class_id: 99 }),
      create: jest.fn().mockResolvedValue({ user_class_id: 1 }),
    },
    users_pr: {
      update: jest.fn().mockResolvedValue({}),
    },
  });

  let transactionMock: ReturnType<typeof createTransactionMock>;

  const ownerActor = {
    actorUserId: '20a9a762-a4fa-49dd-93a6-3851e27f8b69',
    isOwner: true,
  };

  const adminActor = {
    actorUserId: 'admin-user-1',
    isOwner: false,
  };

  const mockPrismaService = {
    $transaction: jest.fn(),
    users: { findUnique: jest.fn(), update: jest.fn() },
    users_pr: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
    emergency_contacts: {
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    legal_representatives: { findUnique: jest.fn(), create: jest.fn() },
    club_role_assignments: { create: jest.fn() },
  };

  const mockUsersService = {
    requiresLegalRepresentative: jest.fn(),
  };

  const mockLegalRepService = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    transactionMock = createTransactionMock();

    mockPrismaService.$transaction.mockImplementation(
      (
        callback: (
          tx: ReturnType<typeof createTransactionMock>,
        ) => Promise<unknown>,
      ) => callback(transactionMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostRegistrationService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: LegalRepresentativesService, useValue: mockLegalRepService },
      ],
    }).compile();

    service = module.get<PostRegistrationService>(PostRegistrationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getStatus', () => {
    it('should omit guided nextStep details for third-party reads', async () => {
      mockPrismaService.users_pr.findUnique.mockResolvedValue({
        complete: false,
        profile_picture_complete: true,
        personal_info_complete: false,
        club_selection_complete: false,
        date_completed: null,
      });

      const result = await service.getStatus('target-user-1', adminActor);

      expect(result).toEqual({
        status: 'success',
        data: {
          complete: false,
          steps: {
            profilePicture: true,
            personalInfo: false,
            clubSelection: false,
          },
          dateCompleted: null,
        },
      });
    });
  });

  describe('completeStep1', () => {
    it('should return a generic validation error for third-party completion', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_image: null,
      });

      await expect(
        service.completeStep1('target-user-1', adminActor),
      ).rejects.toThrow(
        new BadRequestException(
          'No se puede completar el paso 1 para este usuario',
        ),
      );
    });
  });

  describe('completeStep2', () => {
    it('should keep detailed validation feedback for the owner', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        gender: 'M',
        birthday: new Date('2009-03-15'),
        baptism: true,
      });
      mockPrismaService.emergency_contacts.count.mockResolvedValue(0);

      await expect(
        service.completeStep2(ownerActor.actorUserId, ownerActor),
      ).rejects.toThrow(
        new BadRequestException(
          'Debe agregar al menos un contacto de emergencia',
        ),
      );
    });

    it('should hide detailed validation feedback from third-party completion', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        gender: 'M',
        birthday: new Date('2009-03-15'),
        baptism: true,
      });
      mockPrismaService.emergency_contacts.count.mockResolvedValue(0);

      await expect(
        service.completeStep2('target-user-1', adminActor),
      ).rejects.toThrow(
        new BadRequestException(
          'No se puede completar el paso 2 para este usuario',
        ),
      );
    });
  });

  describe('completeStep3', () => {
    const userId = '20a9a762-a4fa-49dd-93a6-3851e27f8b69';
    const dto = {
      country_id: 1,
      union_id: 2,
      local_field_id: 3,
      club_type: 'adventurers' as const,
      club_instance_id: 10,
      class_id: 5,
    };

    it('should reuse existing club assignment and class enrollment on retry', async () => {
      transactionMock.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'assignment-existing',
      });
      transactionMock.users_classes.findUnique.mockResolvedValue({
        user_class_id: 77,
        user_id: userId,
        class_id: dto.class_id,
        active: true,
        current_class: false,
      });

      const result = await service.completeStep3(userId, dto, ownerActor);

      expect(result.status).toBe('success');
      expect(
        transactionMock.club_role_assignments.create,
      ).not.toHaveBeenCalled();
      expect(transactionMock.users_classes.create).not.toHaveBeenCalled();
      expect(transactionMock.users_classes.updateMany).toHaveBeenCalledWith({
        where: {
          user_id: userId,
          current_class: true,
          NOT: { class_id: dto.class_id },
        },
        data: { current_class: false },
      });
      expect(transactionMock.users_classes.update).toHaveBeenCalledWith({
        where: { user_class_id: 77 },
        data: {
          active: true,
          current_class: true,
        },
      });
    });

    it('should throw BadRequestException when class does not exist', async () => {
      transactionMock.classes.findUnique.mockResolvedValue(null);

      await expect(
        service.completeStep3(userId, dto, ownerActor),
      ).rejects.toThrow(BadRequestException);

      expect(transactionMock.users_classes.create).not.toHaveBeenCalled();
      expect(transactionMock.users_pr.update).not.toHaveBeenCalled();
    });

    it('should return a minimal success payload for third-party completion', async () => {
      const result = await service.completeStep3(userId, dto, adminActor);

      expect(result).toEqual({
        status: 'success',
        message: 'Paso 3 completado',
      });
    });

    it('should hide detailed validation feedback from third-party completion failures', async () => {
      transactionMock.club_adventurers.findUnique.mockResolvedValue(null);

      await expect(
        service.completeStep3(userId, dto, adminActor),
      ).rejects.toThrow(
        new BadRequestException(
          'No se puede completar el paso 3 para este usuario',
        ),
      );
    });
  });
});
