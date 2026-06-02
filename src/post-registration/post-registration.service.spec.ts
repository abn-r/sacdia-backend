import { Test, TestingModule } from '@nestjs/testing';
import { ErrorCode } from '../common/errors/error-codes';
import { PostRegistrationService } from './post-registration.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LegalRepresentativesService } from '../legal-representatives/legal-representatives.service';
import { ClassAssignmentResolverService } from '../common/services/class-assignment-resolver.service';
import { MembershipRequestsService } from '../membership-requests/membership-requests.service';

describe('PostRegistrationService', () => {
  let service: PostRegistrationService;

  const createTransactionMock = () => ({
    users: {
      findUnique: jest.fn().mockResolvedValue({
        birthday: new Date('2016-01-01'),
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    ecclesiastical_years: {
      findFirst: jest.fn().mockResolvedValue({
        year_id: 2026,
        start_date: new Date('2026-01-01'),
      }),
    },
    roles: {
      findFirst: jest.fn().mockResolvedValue({ role_id: 'role-member' }),
    },
    club_sections: {
      findUnique: jest.fn().mockResolvedValue({
        club_section_id: 10,
        club_type_id: 2,
      }),
    },
    club_role_assignments: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        assignment_id: 'assignment-1',
        user_id: '20a9a762-a4fa-49dd-93a6-3851e27f8b69',
        club_section_id: 10,
        active: true,
        status: 'pending',
      }),
      update: jest.fn().mockResolvedValue({
        assignment_id: 'assignment-1',
        user_id: '20a9a762-a4fa-49dd-93a6-3851e27f8b69',
        club_section_id: 10,
        active: true,
        status: 'pending',
      }),
    },
    classes: {
      findUnique: jest.fn().mockResolvedValue({
        class_id: 5,
        active: true,
        club_type_id: 2,
        minimum_age: 10,
        available_from_year: null,
        available_until_year: null,
      }),
      findFirst: jest.fn().mockResolvedValue({
        class_id: 5,
        minimum_age: 10,
      }),
    },
    enrollments: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ enrollment_id: 77, active: true }),
      create: jest
        .fn()
        .mockResolvedValue({ enrollment_id: 1001, active: true }),
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

  const mockMembershipRequestsService = {
    notifyNewRequestCreated: jest.fn().mockResolvedValue(undefined),
    cancelPendingForUser: jest.fn(),
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
        ClassAssignmentResolverService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: LegalRepresentativesService, useValue: mockLegalRepService },
        {
          provide: MembershipRequestsService,
          useValue: mockMembershipRequestsService,
        },
      ],
    }).compile();

    service = module.get<PostRegistrationService>(PostRegistrationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPhotoStatus', () => {
    it('should return has_photo true when user_image is set', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_image: 'https://cdn.example.com/photo.jpg',
      });

      const result = await service.getPhotoStatus('target-user-1');

      expect(result).toEqual({ has_photo: true });
    });

    it('should return has_photo false when user_image is null', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_image: null,
      });

      const result = await service.getPhotoStatus('target-user-1');

      expect(result).toEqual({ has_photo: false });
    });

    it('should return has_photo false when user does not exist', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      const result = await service.getPhotoStatus('unknown-user');

      expect(result).toEqual({ has_photo: false });
    });
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
    it('should return a minimal success payload for third-party completion', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_image: 'profile.jpg',
      });

      const result = await service.completeStep1('target-user-1', adminActor);

      expect(result).toEqual({
        status: 'success',
        message: 'Paso 1 completado',
      });
    });

    it('should return a generic validation error for third-party completion', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_image: null,
      });

      await expect(
        service.completeStep1('target-user-1', adminActor),
      ).rejects.toMatchObject({ code: ErrorCode.POST_REG_NOT_INITIATED });
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
      ).rejects.toMatchObject({
        code: ErrorCode.POST_REG_EMERGENCY_CONTACT_REQUIRED,
      });
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
      ).rejects.toMatchObject({ code: ErrorCode.POST_REG_NOT_INITIATED });
    });

    it('should return a minimal success payload for third-party completion', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        gender: 'M',
        birthday: new Date('2009-03-15'),
        baptism: true,
      });
      mockPrismaService.emergency_contacts.count.mockResolvedValue(1);
      mockUsersService.requiresLegalRepresentative.mockResolvedValue(false);

      const result = await service.completeStep2('target-user-1', adminActor);

      expect(result).toEqual({
        status: 'success',
        message: 'Paso 2 completado',
      });
    });
  });

  describe('completeStep3', () => {
    const userId = '20a9a762-a4fa-49dd-93a6-3851e27f8b69';
    const dto = {
      country_id: 1,
      union_id: 2,
      local_field_id: 3,
      club_section_id: 10,
      class_id: 5,
    };

    beforeEach(() => {
      transactionMock.users.findUnique.mockResolvedValue({
        birthday: new Date('2016-01-01'),
      });
    });

    it('should derive the operational class from birthday and selected club type when class_id is omitted', async () => {
      const dtoWithoutClass = {
        country_id: 1,
        union_id: 2,
        local_field_id: 3,
        club_section_id: 10,
      };

      const result = await service.completeStep3(
        userId,
        dtoWithoutClass as any,
        ownerActor,
      );

      expect(result).toMatchObject({
        status: 'success',
        data: {
          classId: 5,
        },
      });
      expect(transactionMock.enrollments.create).toHaveBeenCalledWith({
        data: {
          user_id: userId,
          class_id: 5,
          ecclesiastical_year_id: 2026,
        },
      });
    });

    it('should derive the operational class when class_id is explicitly null', async () => {
      const result = await service.completeStep3(
        userId,
        {
          ...dto,
          class_id: null,
        } as any,
        ownerActor,
      );

      expect(result).toMatchObject({
        status: 'success',
        data: {
          classId: 5,
        },
      });
      expect(transactionMock.classes.findUnique).not.toHaveBeenCalledWith({
        where: { class_id: null },
        select: expect.any(Object),
      });
      expect(transactionMock.enrollments.create).toHaveBeenCalledWith({
        data: {
          user_id: userId,
          class_id: 5,
          ecclesiastical_year_id: 2026,
        },
      });
    });

    it('should reject a selected class that does not match the age-derived class for the selected club type', async () => {
      transactionMock.classes.findUnique.mockResolvedValue({
        class_id: 6,
        active: true,
        club_type_id: 2,
        minimum_age: 11,
        available_from_year: null,
        available_until_year: null,
      });
      transactionMock.classes.findFirst.mockResolvedValue({
        class_id: 5,
        minimum_age: 10,
      });

      await expect(
        service.completeStep3(
          userId,
          {
            ...dto,
            class_id: 6,
          },
          ownerActor,
        ),
      ).rejects.toMatchObject({ code: 'POST_REG_CLASS_NOT_ELIGIBLE' });

      expect(transactionMock.enrollments.create).not.toHaveBeenCalled();
    });

    it('should reject a selected class from a different club type than the selected section', async () => {
      transactionMock.classes.findUnique.mockResolvedValue({
        class_id: 5,
        active: true,
        club_type_id: 3,
        minimum_age: 16,
        available_from_year: null,
        available_until_year: null,
      });

      await expect(
        service.completeStep3(userId, dto, ownerActor),
      ).rejects.toMatchObject({ code: 'POST_REG_CLASS_NOT_ELIGIBLE' });

      expect(transactionMock.enrollments.create).not.toHaveBeenCalled();
    });

    it('should reuse existing club assignment and class enrollment on retry', async () => {
      transactionMock.club_role_assignments.findFirst
        .mockResolvedValueOnce(null) // existingSameType check → no duplicate in a different club
        .mockResolvedValueOnce({ assignment_id: 'assignment-existing' }); // existingAssignment → retry found
      transactionMock.enrollments.findUnique.mockResolvedValue({
        enrollment_id: 501,
        active: true,
      });

      const result = await service.completeStep3(userId, dto, ownerActor);

      expect(result.status).toBe('success');
      expect(
        transactionMock.club_role_assignments.create,
      ).not.toHaveBeenCalled();
      expect(transactionMock.enrollments.create).not.toHaveBeenCalled();
      expect(transactionMock.enrollments.update).not.toHaveBeenCalled();
    });

    it('should create enrollment-first operational truth on first completion', async () => {
      await service.completeStep3(userId, dto, ownerActor);

      expect(transactionMock.enrollments.updateMany).toHaveBeenCalledWith({
        where: {
          user_id: userId,
          ecclesiastical_year_id: 2026,
          active: true,
          NOT: { class_id: dto.class_id },
        },
        data: {
          active: false,
        },
      });
      expect(transactionMock.enrollments.create).toHaveBeenCalledWith({
        data: {
          user_id: userId,
          class_id: dto.class_id,
          ecclesiastical_year_id: 2026,
        },
      });
      expect(transactionMock.users_pr.update).toHaveBeenCalled();
    });

    it('should reject a new club selection when the user already has another pending request', async () => {
      transactionMock.club_role_assignments.findFirst.mockResolvedValueOnce({
        assignment_id: 'pending-other-section',
        user_id: userId,
        club_section_id: 99,
        status: 'pending',
        active: true,
      });

      await expect(
        service.completeStep3(userId, dto, ownerActor),
      ).rejects.toMatchObject({
        code: ErrorCode.POST_REG_DUPLICATE_MEMBERSHIP,
      });

      expect(
        transactionMock.club_role_assignments.create,
      ).not.toHaveBeenCalled();
      expect(transactionMock.enrollments.create).not.toHaveBeenCalled();
      expect(transactionMock.users_pr.update).not.toHaveBeenCalled();
    });

    it('should notify section reviewers when a pending membership request is created', async () => {
      await service.completeStep3(userId, dto, ownerActor);

      expect(
        mockMembershipRequestsService.notifyNewRequestCreated,
      ).toHaveBeenCalledWith({
        userId,
        clubSectionId: dto.club_section_id,
        assignmentId: 'assignment-1',
      });
    });

    it('should reactivate existing inactive enrollment without resetting metadata', async () => {
      transactionMock.enrollments.findUnique.mockResolvedValue({
        enrollment_id: 1002,
        active: false,
        investiture_status: 'VALIDATED',
        submitted_for_validation: true,
      });

      await service.completeStep3(userId, dto, ownerActor);

      expect(transactionMock.enrollments.create).not.toHaveBeenCalled();
      expect(transactionMock.enrollments.update).toHaveBeenCalledWith({
        where: {
          enrollment_id: 1002,
        },
        data: {
          active: true,
        },
      });
    });

    it('should recover from enrollment unique conflict by re-reading tuple', async () => {
      transactionMock.enrollments.create.mockRejectedValue({
        code: 'P2002',
      });
      transactionMock.enrollments.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          enrollment_id: 1009,
          active: true,
        });

      const result = await service.completeStep3(userId, dto, ownerActor);

      expect(result.status).toBe('success');
      expect(transactionMock.enrollments.create).toHaveBeenCalledTimes(1);
      expect(transactionMock.enrollments.findUnique).toHaveBeenCalledTimes(2);
    });

    it('should fail when enrollment conflict cannot be resolved', async () => {
      transactionMock.enrollments.create.mockRejectedValue({
        code: 'P2002',
      });
      transactionMock.enrollments.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      await expect(
        service.completeStep3(userId, dto, ownerActor),
      ).rejects.toMatchObject({ code: ErrorCode.POST_REG_ENROLLMENT_FAILED });
    });

    it('should recover member assignment on duplicate create race', async () => {
      transactionMock.club_role_assignments.create.mockRejectedValue({
        code: 'P2002',
      });
      transactionMock.club_role_assignments.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          assignment_id: 'assignment-recovered',
          active: true,
        });

      const result = await service.completeStep3(userId, dto, ownerActor);

      expect(result.status).toBe('success');
      expect(
        transactionMock.club_role_assignments.findFirst,
      ).toHaveBeenCalledTimes(2);
    });

    it('should deactivate other active same-year enrollments when switching classes', async () => {
      await service.completeStep3(userId, dto, ownerActor);

      expect(transactionMock.enrollments.updateMany).toHaveBeenCalledWith({
        where: {
          user_id: userId,
          ecclesiastical_year_id: 2026,
          active: true,
          NOT: { class_id: dto.class_id },
        },
        data: {
          active: false,
        },
      });
    });

    it('should fail atomically when no active ecclesiastical year exists', async () => {
      transactionMock.ecclesiastical_years.findFirst.mockResolvedValue(null);

      await expect(
        service.completeStep3(userId, dto, ownerActor),
      ).rejects.toMatchObject({ code: ErrorCode.POST_REG_NO_ACTIVE_YEAR });

      expect(transactionMock.enrollments.create).not.toHaveBeenCalled();
      expect(transactionMock.users_pr.update).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when class does not exist', async () => {
      transactionMock.classes.findUnique.mockResolvedValue(null);

      await expect(
        service.completeStep3(userId, dto, ownerActor),
      ).rejects.toMatchObject({ code: ErrorCode.POST_REG_CLASS_NOT_FOUND });

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
      transactionMock.club_sections.findUnique.mockResolvedValue(null);

      await expect(
        service.completeStep3(userId, dto, adminActor),
      ).rejects.toMatchObject({ code: ErrorCode.POST_REG_NOT_INITIATED });
    });
  });

  describe('cancelPendingMembershipRequest', () => {
    it('should cancel the pending request through membership requests and reopen club selection for the owner', async () => {
      mockMembershipRequestsService.cancelPendingForUser.mockResolvedValue({
        assignment_id: 'assignment-1',
      });

      const result = await service.cancelPendingMembershipRequest(
        ownerActor.actorUserId,
        ownerActor,
      );

      expect(
        mockMembershipRequestsService.cancelPendingForUser,
      ).toHaveBeenCalledWith(ownerActor.actorUserId, ownerActor.actorUserId);
      expect(result).toEqual({
        status: 'success',
        message:
          'Solicitud de membresía cancelada. Puedes elegir club y sección nuevamente.',
      });
    });
  });
});
