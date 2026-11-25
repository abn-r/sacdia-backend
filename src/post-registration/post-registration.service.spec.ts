import { Test, TestingModule } from '@nestjs/testing';
import { ErrorCode } from '../common/errors/error-codes';
import { PostRegistrationService } from './post-registration.service';
import { PrismaService } from '../prisma/prisma.service';
import { CountryAgePolicyService } from '../common/age/country-age-policy.service';
import { ClassAssignmentResolverService } from '../common/services/class-assignment-resolver.service';
import { MembershipRequestsService } from '../membership-requests/membership-requests.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { ClubRoleEligibilityService } from '../club-role-eligibility/club-role-eligibility.service';
import {
  AppBadRequestException,
  AppForbiddenException,
} from '../common/errors/app.exception';
import { ActingForCache } from '../auth/acting-for/acting-for.cache';
import { PostRegistrationRowService } from '../common/services/post-registration-row.service';
import { OnboardingModeService } from './onboarding/onboarding-mode.service';

// Territory of the club behind section 10: country 1 > union 2 > field 3.
const sectionClub = {
  local_field_id: 3,
  local_fields: { union_id: 2, unions: { country_id: 1 } },
};

const GUARDIAN_ID = '9f1d9a40-79f0-4e0c-a8c7-5f0f1c7d9a11';

describe('PostRegistrationService', () => {
  let service: PostRegistrationService;
  let ageRangeSpy: jest.SpyInstance;

  const createTransactionMock = () => ({
    users: {
      findUnique: jest.fn().mockResolvedValue({
        birthday: new Date('2016-01-01'),
      }),
      update: jest.fn().mockResolvedValue({
        user_id: '20a9a762-a4fa-49dd-93a6-3851e27f8b69',
      }),
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
        clubs: sectionClub,
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
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ enrollment_id: 77, active: true }),
      create: jest
        .fn()
        .mockResolvedValue({ enrollment_id: 1001, active: true }),
    },
    users_pr: {
      findUnique: jest.fn().mockResolvedValue({ user_id: 'u' }),
      update: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
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
    users_pr: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
    },
    emergency_contacts: {
      findMany: jest.fn(),
      create: jest.fn(),
      count: jest.fn(),
    },
    club_role_assignments: { create: jest.fn() },
  };

  const mockCountryAgePolicy = {
    getPolicy: jest.fn(),
  };

  const mockMembershipRequestsService = {
    notifyNewRequestCreated: jest.fn().mockResolvedValue(undefined),
    cancelPendingForUser: jest.fn(),
  };

  const mockAuthorizationContextService = {
    invalidateUserAuthorizationCache: jest.fn().mockResolvedValue(undefined),
    resolveUserAuthorization: jest.fn(),
  };

  /** Minimal fully resolved profile: global roles and visible club grants. */
  const profileWith = (
    globalRoles: string[],
    clubAssignments: unknown[] = [],
  ) => ({
    authorization: {
      grants: {
        global_roles: globalRoles.map((role_name) => ({
          role_name,
          permissions: [],
          scope: {},
        })),
        club_assignments: clubAssignments,
        direct_permissions: [],
      },
      active_assignment: { assignment_id: null },
      effective: { permissions: [], scope: { global: {}, club: null } },
    },
    legacy: { roles: globalRoles },
  });
  const visibleClub = [{ assignment_id: 'a-1', status: 'active' }];
  const asMode = (mode: 'club' | 'club_exempt' | 'panel_only') =>
    mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
      mode === 'club'
        ? profileWith(['user'], visibleClub)
        : mode === 'club_exempt'
          ? profileWith(['pastor'])
          : // Every catalog role has a surface now; this stands for one without.
            profileWith(['future-panel-role']),
    );

  const mockRoleEligibility = {
    assertAssignment: jest.fn(),
  };

  const mockActingForCache = {
    bump: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRoleEligibility.assertAssignment.mockReset().mockResolvedValue({
      allowed: true,
    });

    mockCountryAgePolicy.getPolicy.mockReset().mockResolvedValue({
      minSelfLoginAge: 13,
      ageOfMajority: 18,
      timeZone: 'America/Mexico_City',
    });

    transactionMock = createTransactionMock();

    // Default: the user already has a users_pr row (the common case).
    mockPrismaService.users_pr.findUnique.mockReset().mockResolvedValue({
      user_id: 'target-user-1',
      complete: false,
      profile_picture_complete: false,
      personal_info_complete: false,
      club_selection_complete: false,
      date_completed: null,
    });
    mockPrismaService.users_pr.createMany.mockReset().mockResolvedValue({
      count: 1,
    });
    mockPrismaService.users.findUnique.mockReset();
    mockPrismaService.users_pr.updateMany
      .mockReset()
      .mockResolvedValue({ count: 0 });
    asMode('club');

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
        PostRegistrationRowService,
        OnboardingModeService,
        ClassAssignmentResolverService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: CountryAgePolicyService, useValue: mockCountryAgePolicy },
        {
          provide: MembershipRequestsService,
          useValue: mockMembershipRequestsService,
        },
        {
          provide: AuthorizationContextService,
          useValue: mockAuthorizationContextService,
        },
        { provide: ClubRoleEligibilityService, useValue: mockRoleEligibility },
        { provide: ActingForCache, useValue: mockActingForCache },
      ],
    }).compile();

    service = module.get<PostRegistrationService>(PostRegistrationService);
    // The age range has its own spec (class-assignment-resolver); here it
    // must not consume the transaction mocks of the class resolution.
    ageRangeSpy = jest
      .spyOn(
        module.get(ClassAssignmentResolverService),
        'assertAgeWithinClubTypeRange',
      )
      .mockResolvedValue(undefined);
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
          onboarding_mode: 'club',
        },
      });
    });

    describe('onboarding mode', () => {
      const row = (overrides: Record<string, unknown> = {}) => ({
        user_id: 'target-user-1',
        complete: false,
        profile_picture_complete: false,
        personal_info_complete: false,
        club_selection_complete: false,
        date_completed: null,
        ...overrides,
      });

      it('S2.8 club: nextStep goes 1 -> 2 -> 3 -> null', async () => {
        asMode('club');
        const steps: Array<[Record<string, unknown>, string | null]> = [
          [{}, 'profilePicture'],
          [{ profile_picture_complete: true }, 'personalInfo'],
          [
            { profile_picture_complete: true, personal_info_complete: true },
            'clubSelection',
          ],
          [
            {
              profile_picture_complete: true,
              personal_info_complete: true,
              club_selection_complete: true,
            },
            null,
          ],
        ];
        for (const [overrides, expected] of steps) {
          mockPrismaService.users_pr.findUnique.mockResolvedValue(
            row(overrides),
          );
          const result = await service.getStatus('target-user-1', ownerActor);
          expect(result.data).toMatchObject({
            nextStep: expected,
            onboarding_mode: 'club',
          });
        }
        expect(mockPrismaService.users_pr.updateMany).not.toHaveBeenCalled();
      });

      it('S2.9 club_exempt: nextStep goes profilePicture -> personalInfo -> null', async () => {
        asMode('club_exempt');
        mockPrismaService.users_pr.findUnique.mockResolvedValue(row());
        expect(
          (await service.getStatus('target-user-1', ownerActor)).data,
        ).toMatchObject({
          nextStep: 'profilePicture',
          onboarding_mode: 'club_exempt',
        });

        mockPrismaService.users_pr.findUnique.mockResolvedValue(
          row({ profile_picture_complete: true }),
        );
        expect(
          (await service.getStatus('target-user-1', ownerActor)).data,
        ).toMatchObject({ nextStep: 'personalInfo' });

        mockPrismaService.users_pr.findUnique.mockResolvedValue(
          row({
            profile_picture_complete: true,
            personal_info_complete: true,
            complete: true,
          }),
        );
        expect(
          (await service.getStatus('target-user-1', ownerActor)).data,
        ).toMatchObject({ nextStep: null, complete: true });
      });

      it('S2.10 panel_only: nextStep null and complete keeps the stored value', async () => {
        asMode('panel_only');
        mockPrismaService.users_pr.findUnique.mockResolvedValue(row());

        const result = await service.getStatus('target-user-1', ownerActor);

        expect(result.data).toMatchObject({
          nextStep: null,
          complete: false,
          onboarding_mode: 'panel_only',
        });
        expect(mockPrismaService.users_pr.updateMany).not.toHaveBeenCalled();
      });

      it('S1.9 a plain user with no club gets club and the three steps', async () => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          profileWith(['user']),
        );
        mockPrismaService.users_pr.findUnique.mockResolvedValue(
          row({ profile_picture_complete: true, personal_info_complete: true }),
        );

        const result = await service.getStatus('target-user-1', ownerActor);

        expect(result.data).toMatchObject({
          nextStep: 'clubSelection',
          onboarding_mode: 'club',
        });
      });

      it('S2.7 reconcile flips complete once, invalidates caches, and a second read changes nothing', async () => {
        asMode('club_exempt');
        const done = row({
          profile_picture_complete: true,
          personal_info_complete: true,
        });
        mockPrismaService.users_pr.findUnique
          .mockResolvedValueOnce(done)
          .mockResolvedValueOnce({ ...done, complete: true })
          .mockResolvedValue({ ...done, complete: true });
        mockPrismaService.users_pr.updateMany
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValue({ count: 0 });

        const first = await service.getStatus('target-user-1', ownerActor);
        const second = await service.getStatus('target-user-1', ownerActor);

        expect(first.data).toMatchObject({ complete: true, nextStep: null });
        expect(second.data).toMatchObject({ complete: true });
        expect(mockPrismaService.users_pr.updateMany).toHaveBeenCalledWith({
          where: {
            user_id: 'target-user-1',
            complete: false,
            profile_picture_complete: true,
            personal_info_complete: true,
          },
          data: { complete: true, date_completed: expect.any(Date) },
        });
        expect(
          mockAuthorizationContextService.invalidateUserAuthorizationCache,
        ).toHaveBeenCalledTimes(1);
        expect(mockActingForCache.bump).toHaveBeenCalledTimes(1);
      });

      it('S1.14 / S1.15 a member that lost the last club reconciles (club_exempt, steps 1-2 done)', async () => {
        asMode('club_exempt');
        mockPrismaService.users_pr.findUnique.mockResolvedValue(
          row({ profile_picture_complete: true, personal_info_complete: true }),
        );
        mockPrismaService.users_pr.updateMany.mockResolvedValue({ count: 1 });

        await service.getStatus('target-user-1', ownerActor);

        expect(mockPrismaService.users_pr.updateMany).toHaveBeenCalledTimes(1);
      });

      it('exposes onboarding_mode to the admin view too, without nextStep', async () => {
        asMode('club_exempt');
        mockPrismaService.users_pr.findUnique.mockResolvedValue(row());

        const result = await service.getStatus('target-user-1', adminActor);

        expect(result.data).toMatchObject({ onboarding_mode: 'club_exempt' });
        expect(result.data).not.toHaveProperty('nextStep');
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

    it('no longer requires a legal representative for minors (FP-25)', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        gender: 'F',
        birthday: new Date('2016-03-15'),
        baptism: false,
      });
      mockPrismaService.emergency_contacts.count.mockResolvedValue(1);

      const result = await service.completeStep2(
        ownerActor.actorUserId,
        ownerActor,
      );

      expect(result).toMatchObject({ status: 'success' });
      expect(mockPrismaService.users_pr.update).toHaveBeenCalledWith({
        where: { user_id: ownerActor.actorUserId },
        data: { personal_info_complete: true },
      });
    });

    it('should return a minimal success payload for third-party completion', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        gender: 'M',
        birthday: new Date('2009-03-15'),
        baptism: true,
      });
      mockPrismaService.emergency_contacts.count.mockResolvedValue(1);

      const result = await service.completeStep2('target-user-1', adminActor);

      expect(result).toEqual({
        status: 'success',
        message: 'Paso 2 completado',
      });
    });

    describe('onboarding reconcile', () => {
      const step2Fixtures = () => {
        mockPrismaService.users.findUnique.mockResolvedValue({
          gender: 'M',
          birthday: new Date('2009-03-15'),
          baptism: true,
        });
        mockPrismaService.emergency_contacts.count.mockResolvedValue(1);
      };

      it('S2.1 club_exempt: completing step 2 reconciles complete', async () => {
        asMode('club_exempt');
        step2Fixtures();
        mockPrismaService.users_pr.updateMany.mockResolvedValue({ count: 1 });

        await service.completeStep2(ownerActor.actorUserId, ownerActor);

        expect(mockPrismaService.users_pr.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              user_id: ownerActor.actorUserId,
              complete: false,
              profile_picture_complete: true,
              personal_info_complete: true,
            }),
          }),
        );
        expect(
          mockAuthorizationContextService.invalidateUserAuthorizationCache,
        ).toHaveBeenCalledWith(ownerActor.actorUserId);
        expect(mockActingForCache.bump).toHaveBeenCalledWith(
          ownerActor.actorUserId,
        );
      });

      it('S2.15 an admin override of step 2 also reconciles', async () => {
        asMode('club_exempt');
        step2Fixtures();
        mockPrismaService.users_pr.updateMany.mockResolvedValue({ count: 1 });

        await service.completeStep2('target-user-1', adminActor);

        expect(mockPrismaService.users_pr.updateMany).toHaveBeenCalledTimes(1);
        expect(
          mockAuthorizationContextService.invalidateUserAuthorizationCache,
        ).toHaveBeenCalledWith('target-user-1');
      });

      it('S2.15 an admin override of step 1 reconciles when step 2 is done', async () => {
        asMode('club_exempt');
        mockPrismaService.users.findUnique.mockResolvedValue({
          user_image: 'profile.jpg',
        });
        mockPrismaService.users_pr.updateMany.mockResolvedValue({ count: 1 });

        await service.completeStep1('target-user-1', adminActor);

        expect(mockPrismaService.users_pr.updateMany).toHaveBeenCalledTimes(1);
      });

      it('S2.12 panel_only: steps 1 and 2 are accepted and never mark complete', async () => {
        asMode('panel_only');
        step2Fixtures();

        const result = await service.completeStep2(
          ownerActor.actorUserId,
          ownerActor,
        );

        expect(result).toMatchObject({ status: 'success' });
        expect(mockPrismaService.users_pr.updateMany).not.toHaveBeenCalled();
        expect(
          mockAuthorizationContextService.invalidateUserAuthorizationCache,
        ).not.toHaveBeenCalled();
      });

      it('club users are not reconciled by steps 1-2 (step 3 completes them)', async () => {
        asMode('club');
        step2Fixtures();

        await service.completeStep2(ownerActor.actorUserId, ownerActor);

        expect(mockPrismaService.users_pr.updateMany).not.toHaveBeenCalled();
      });

      it('a reconcile failure never fails the step', async () => {
        asMode('club_exempt');
        step2Fixtures();
        mockPrismaService.users_pr.updateMany.mockRejectedValue(
          new Error('db down'),
        );

        await expect(
          service.completeStep2(ownerActor.actorUserId, ownerActor),
        ).resolves.toMatchObject({ status: 'success' });
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

    it('derives country, union and local field from the section, not the body', async () => {
      await service.completeStep3(
        userId,
        { club_section_id: 10, class_id: 5 },
        ownerActor,
      );

      expect(transactionMock.users.update).toHaveBeenCalledWith({
        where: { user_id: userId },
        data: { country_id: 1, union_id: 2, local_field_id: 3 },
        select: { user_id: true },
      });
    });

    it.each([
      ['country_id', 9],
      ['union_id', 9],
      ['local_field_id', 9],
    ])(
      'rejects a body %s that does not match the section with POST_REG_CLUB_LOCATION_MISMATCH',
      async (field, value) => {
        await expect(
          service.completeStep3(userId, { ...dto, [field]: value }, ownerActor),
        ).rejects.toMatchObject({
          code: ErrorCode.POST_REG_CLUB_LOCATION_MISMATCH,
          status: 400,
        });
        expect(transactionMock.users.update).not.toHaveBeenCalled();
      },
    );

    it('rejects a section whose club cannot be resolved', async () => {
      transactionMock.club_sections.findUnique.mockResolvedValue({
        club_section_id: 10,
        club_type_id: 2,
        clubs: null,
      });

      await expect(
        service.completeStep3(userId, dto, ownerActor),
      ).rejects.toMatchObject({ code: ErrorCode.POST_REG_CLUB_NOT_FOUND });
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
        dtoWithoutClass,
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
        .mockResolvedValueOnce(null) // no active role already held in the selected section
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
          cross_type_enrollment: false,
          record_kind: { not: 'HISTORICAL_CERTIFICATE' },
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

    it('asserts member eligibility in the selected section before creating the pending member', async () => {
      await service.completeStep3(userId, dto, ownerActor);

      expect(mockRoleEligibility.assertAssignment).toHaveBeenCalledWith({
        userId,
        roleName: 'member',
        clubSectionId: 10,
        db: transactionMock,
      });
    });

    it('rejects a GM-eligible user picking an AV/CQ section and writes nothing', async () => {
      mockRoleEligibility.assertAssignment.mockRejectedValueOnce(
        new AppForbiddenException(
          ErrorCode.CLUB_ROLE_MEMBER_REQUIRES_GUIDE_MAJOR_SECTION,
        ),
      );

      await expect(
        service.completeStep3(userId, dto, ownerActor),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_ROLE_MEMBER_REQUIRES_GUIDE_MAJOR_SECTION,
      });

      expect(
        transactionMock.club_role_assignments.create,
      ).not.toHaveBeenCalled();
      expect(
        transactionMock.club_role_assignments.update,
      ).not.toHaveBeenCalled();
      expect(transactionMock.enrollments.create).not.toHaveBeenCalled();
      expect(transactionMock.users_pr.update).not.toHaveBeenCalled();
    });

    it('rejects a member older than the selected club type and writes nothing (2026-11-02)', async () => {
      ageRangeSpy.mockRejectedValueOnce(
        new AppBadRequestException(ErrorCode.POST_REG_AGE_ABOVE_CLUB_TYPE, {
          age: 36,
          maxAge: 9,
          clubTypeId: 1,
        }),
      );

      await expect(
        service.completeStep3(userId, dto, ownerActor),
      ).rejects.toMatchObject({ code: ErrorCode.POST_REG_AGE_ABOVE_CLUB_TYPE });

      expect(ageRangeSpy).toHaveBeenCalledWith(
        transactionMock,
        expect.objectContaining({ userId }),
      );
      expect(
        transactionMock.club_role_assignments.create,
      ).not.toHaveBeenCalled();
      expect(transactionMock.enrollments.create).not.toHaveBeenCalled();
      expect(transactionMock.users_pr.update).not.toHaveBeenCalled();
    });

    it('should reject a new club selection when the user already has another pending request', async () => {
      transactionMock.club_role_assignments.findFirst
        .mockResolvedValueOnce(null) // no active role already held in the selected section
        .mockResolvedValueOnce({
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

    it('accepts an active role already held in the selected section as the club selection', async () => {
      transactionMock.club_role_assignments.findFirst.mockResolvedValueOnce({
        assignment_id: 'director-assignment',
        user_id: userId,
        club_section_id: dto.club_section_id,
        status: 'active',
        active: true,
      });

      const result = await service.completeStep3(userId, dto, ownerActor);

      expect(result.status).toBe('success');
      expect(
        transactionMock.club_role_assignments.findFirst,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: userId,
            active: true,
            status: 'active',
            club_section_id: dto.club_section_id,
          }),
        }),
      );
      expect(
        transactionMock.club_role_assignments.create,
      ).not.toHaveBeenCalled();
      expect(
        transactionMock.club_role_assignments.update,
      ).not.toHaveBeenCalled();
      expect(mockRoleEligibility.assertAssignment).not.toHaveBeenCalled();
      expect(transactionMock.users_pr.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { user_id: userId },
          data: expect.objectContaining({ complete: true }),
        }),
      );
      expect(
        mockMembershipRequestsService.notifyNewRequestCreated,
      ).not.toHaveBeenCalled();
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

    it('creates the dependent membership request and returns the owner response while acting (FP-25)', async () => {
      // While acting, req.user.sub is the dependent, so the controller builds
      // an owner context (actorUserId === userId).
      const result = await service.completeStep3(userId, dto, {
        actorUserId: userId,
        isOwner: true,
      });

      expect(result).toMatchObject({
        status: 'success',
        message: 'Post-registro completado exitosamente',
      });
      expect(transactionMock.club_role_assignments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ user_id: userId, status: 'pending' }),
        }),
      );
      expect(
        mockMembershipRequestsService.notifyNewRequestCreated,
      ).toHaveBeenCalledWith(expect.objectContaining({ userId }));
    });

    it('refuses to close the post-registration without a birthday on file (an unknown age never turns into an adult by skipping step 2)', async () => {
      transactionMock.users.findUnique.mockResolvedValue({ birthday: null });

      await expect(
        service.completeStep3(userId, dto, ownerActor),
      ).rejects.toMatchObject({
        code: ErrorCode.POST_REG_PERSONAL_INFO_INCOMPLETE,
        status: 400,
      });
      expect(transactionMock.users_pr.update).not.toHaveBeenCalled();
      expect(mockActingForCache.bump).not.toHaveBeenCalled();
    });

    it('moves the principal epoch after the commit (the cached principal kind is re-read)', async () => {
      await service.completeStep3(userId, dto, ownerActor);

      expect(mockActingForCache.bump).toHaveBeenCalledWith(userId);
      expect(
        mockActingForCache.bump.mock.invocationCallOrder[0],
      ).toBeGreaterThan(
        Math.max(...transactionMock.users_pr.update.mock.invocationCallOrder),
      );
    });

    it('should invalidate authorization cache after completing membership request', async () => {
      await service.completeStep3(userId, dto, ownerActor);

      expect(
        mockAuthorizationContextService.invalidateUserAuthorizationCache,
      ).toHaveBeenCalledTimes(1);
      expect(
        mockAuthorizationContextService.invalidateUserAuthorizationCache,
      ).toHaveBeenCalledWith(userId);
    });

    it('derives versioning and cleanup identity from the persisted scope write', async () => {
      const persistedUserId = '85b08cc9-01ee-4f8f-a7e4-14accdb6121d';
      transactionMock.users.update.mockResolvedValue({
        user_id: persistedUserId,
      });

      await service.completeStep3(userId, dto, ownerActor);

      expect(transactionMock.users.update).toHaveBeenCalledWith(
        expect.objectContaining({ select: { user_id: true } }),
      );
      expect(
        mockAuthorizationContextService.invalidateUserAuthorizationCache,
      ).toHaveBeenCalledWith(persistedUserId);
    });

    it('does not adopt a HISTORICAL_CERTIFICATE enrollment as operational', async () => {
      transactionMock.enrollments.findUnique.mockResolvedValue({
        enrollment_id: 15,
        active: true,
        record_kind: 'HISTORICAL_CERTIFICATE',
      });

      await expect(
        service.completeStep3(userId, dto, ownerActor),
      ).rejects.toMatchObject({ code: ErrorCode.CLASS_ALREADY_ENROLLED });

      expect(transactionMock.enrollments.create).not.toHaveBeenCalled();
      expect(transactionMock.enrollments.update).not.toHaveBeenCalled();
      expect(transactionMock.users_pr.update).not.toHaveBeenCalled();
    });

    it('does not create a second Guía Mayor GM-01 enrollment when a prior row exists', async () => {
      transactionMock.users.findUnique.mockResolvedValue({
        birthday: new Date('2000-01-01'),
      });
      transactionMock.club_sections.findUnique.mockResolvedValue({
        club_section_id: 10,
        club_type_id: 3,
        clubs: sectionClub,
      });
      transactionMock.classes.findUnique.mockResolvedValue({
        class_id: 5,
        active: true,
        club_type_id: 3,
        minimum_age: 16,
        asset_code: 'GM-01',
        available_from_year: null,
        available_until_year: null,
      });
      transactionMock.classes.findFirst.mockResolvedValue({
        class_id: 5,
        minimum_age: 16,
      });
      transactionMock.enrollments.findUnique.mockResolvedValue(null);
      transactionMock.enrollments.findFirst.mockResolvedValue({
        enrollment_id: 15,
      });

      await expect(
        service.completeStep3(userId, dto, ownerActor),
      ).rejects.toMatchObject({ code: ErrorCode.CLASS_ALREADY_ENROLLED });

      expect(transactionMock.enrollments.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            user_id: userId,
            class_id: dto.class_id,
          },
        }),
      );
      expect(transactionMock.enrollments.create).not.toHaveBeenCalled();
      expect(transactionMock.users_pr.update).not.toHaveBeenCalled();
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
        .mockResolvedValueOnce(null) // no active role already held in the selected section
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          assignment_id: 'assignment-recovered',
          active: true,
        });

      const result = await service.completeStep3(userId, dto, ownerActor);

      expect(result.status).toBe('success');
      expect(
        transactionMock.club_role_assignments.findFirst,
      ).toHaveBeenCalledTimes(3);
    });

    it('should deactivate other active same-year enrollments when switching classes', async () => {
      await service.completeStep3(userId, dto, ownerActor);

      expect(transactionMock.enrollments.updateMany).toHaveBeenCalledWith({
        where: {
          user_id: userId,
          ecclesiastical_year_id: 2026,
          active: true,
          cross_type_enrollment: false,
          record_kind: { not: 'HISTORICAL_CERTIFICATE' },
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

  describe('completeGuardianOnly', () => {
    const adultBirthday = new Date('1985-05-10');

    const mockUser = (overrides: Record<string, unknown> = {}) =>
      mockPrismaService.users.findUnique.mockResolvedValue({
        birthday: adultBirthday,
        country_id: 1,
        account: [{ id: 'acc-1' }],
        ...overrides,
      });

    const guardianActor = { actorUserId: GUARDIAN_ID, isOwner: true };

    it('completes an adult guardian with 0 dependents and no geo (FP-27)', async () => {
      mockUser();

      const result = await service.completeGuardianOnly(
        GUARDIAN_ID,
        {},
        guardianActor,
      );

      expect(result).toEqual({
        status: 'success',
        message: 'Post-registro completado',
        data: { mode: 'guardian_only' },
      });
      expect(transactionMock.users.update).not.toHaveBeenCalled();
      expect(transactionMock.users_pr.update).toHaveBeenCalledWith({
        where: { user_id: GUARDIAN_ID },
        data: {
          club_selection_complete: true,
          complete: true,
          date_completed: expect.any(Date),
        },
      });
      expect(
        mockAuthorizationContextService.invalidateUserAuthorizationCache,
      ).toHaveBeenCalledWith(GUARDIAN_ID);
      expect(mockActingForCache.bump).toHaveBeenCalledWith(GUARDIAN_ID);
    });

    it('stores the optional geography when provided and uses its country policy', async () => {
      mockUser();

      await service.completeGuardianOnly(
        GUARDIAN_ID,
        { country_id: 7, union_id: 8, local_field_id: 9 },
        guardianActor,
      );

      expect(mockCountryAgePolicy.getPolicy).toHaveBeenCalledWith(7);
      expect(transactionMock.users.update).toHaveBeenCalledWith({
        where: { user_id: GUARDIAN_ID },
        data: { country_id: 7, union_id: 8, local_field_id: 9 },
      });
    });

    it('falls back to the stored country for the age policy when no geo is sent', async () => {
      mockUser({ country_id: 4 });

      await service.completeGuardianOnly(GUARDIAN_ID, {}, guardianActor);

      expect(mockCountryAgePolicy.getPolicy).toHaveBeenCalledWith(4);
    });

    it('rejects a 17-year-old account with 422 and writes nothing', async () => {
      const seventeen = new Date();
      seventeen.setUTCFullYear(seventeen.getUTCFullYear() - 17);
      mockUser({ birthday: seventeen });

      await expect(
        service.completeGuardianOnly(GUARDIAN_ID, {}, guardianActor),
      ).rejects.toMatchObject({
        code: ErrorCode.POST_REG_GUARDIAN_ONLY_REQUIRES_ADULT,
        status: 422,
      });
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('applies the country age of majority (16 makes a 17-year-old adult)', async () => {
      const seventeen = new Date();
      seventeen.setUTCFullYear(seventeen.getUTCFullYear() - 17);
      mockUser({ birthday: seventeen });
      mockCountryAgePolicy.getPolicy.mockResolvedValue({
        minSelfLoginAge: 13,
        ageOfMajority: 16,
        timeZone: 'America/Mexico_City',
      });

      await expect(
        service.completeGuardianOnly(GUARDIAN_ID, {}, guardianActor),
      ).resolves.toMatchObject({ data: { mode: 'guardian_only' } });
    });

    it('rejects a user without a birthday or without an account', async () => {
      mockUser({ birthday: null });
      await expect(
        service.completeGuardianOnly(GUARDIAN_ID, {}, guardianActor),
      ).rejects.toMatchObject({
        code: ErrorCode.POST_REG_GUARDIAN_ONLY_REQUIRES_ADULT,
      });

      mockUser({ account: [] });
      await expect(
        service.completeGuardianOnly(GUARDIAN_ID, {}, guardianActor),
      ).rejects.toMatchObject({
        code: ErrorCode.POST_REG_GUARDIAN_ONLY_REQUIRES_ADULT,
      });
    });

    it('is owner-only: a third party cannot close it for someone else', async () => {
      await expect(
        service.completeGuardianOnly(GUARDIAN_ID, {}, adminActor),
      ).rejects.toMatchObject({ code: ErrorCode.POST_REG_NOT_INITIATED });
      expect(mockPrismaService.users.findUnique).not.toHaveBeenCalled();
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
      ).toHaveBeenCalledWith(ownerActor.actorUserId, ownerActor.actorUserId, {
        preserveCompletion: false,
      });
      expect(result).toEqual({
        status: 'success',
        message:
          'Solicitud de membresía cancelada. Puedes elegir club y sección nuevamente.',
      });
    });

    it('S2.16 a club_exempt user whose only grant is the pending one keeps complete', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        profileWith(['pastor'], [{ assignment_id: 'a-p', status: 'pending' }]),
      );
      mockMembershipRequestsService.cancelPendingForUser.mockResolvedValue({
        assignment_id: 'a-p',
      });

      await service.cancelPendingMembershipRequest(
        ownerActor.actorUserId,
        ownerActor,
      );

      expect(
        mockMembershipRequestsService.cancelPendingForUser,
      ).toHaveBeenCalledWith(ownerActor.actorUserId, ownerActor.actorUserId, {
        preserveCompletion: true,
      });
    });

    it('S2.17 a pastor that also holds another visible club still reopens registration', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        profileWith(
          ['pastor'],
          [
            { assignment_id: 'a-p', status: 'pending' },
            { assignment_id: 'a-i', status: 'inactive' },
          ],
        ),
      );
      mockMembershipRequestsService.cancelPendingForUser.mockResolvedValue({});

      await service.cancelPendingMembershipRequest(
        ownerActor.actorUserId,
        ownerActor,
      );

      expect(
        mockMembershipRequestsService.cancelPendingForUser,
      ).toHaveBeenCalledWith(ownerActor.actorUserId, ownerActor.actorUserId, {
        preserveCompletion: false,
      });
    });
  });

  describe('lazy users_pr initialisation (user without a row)', () => {
    const userId = '20a9a762-a4fa-49dd-93a6-3851e27f8b69';
    const freshRow = {
      user_id: userId,
      complete: false,
      profile_picture_complete: false,
      personal_info_complete: false,
      club_selection_complete: false,
      date_completed: null,
    };

    /** First read: no row; after createMany the row exists. */
    const givenNoRow = (db = mockPrismaService) => {
      db.users_pr.findUnique
        .mockReset()
        .mockResolvedValueOnce(null)
        .mockResolvedValue(freshRow);
    };

    it('getStatus creates the row and reports nothing completed', async () => {
      givenNoRow();
      mockPrismaService.users.findUnique.mockResolvedValue({ active: true });

      const result = await service.getStatus(userId, ownerActor);

      expect(mockPrismaService.users_pr.createMany).toHaveBeenCalledWith({
        data: [
          {
            user_id: userId,
            complete: false,
            profile_picture_complete: false,
            personal_info_complete: false,
            club_selection_complete: false,
          },
        ],
        skipDuplicates: true,
      });
      expect(result).toEqual({
        status: 'success',
        data: {
          complete: false,
          steps: {
            profilePicture: false,
            personalInfo: false,
            clubSelection: false,
          },
          nextStep: 'profilePicture',
          dateCompleted: null,
          onboarding_mode: 'club',
        },
      });
    });

    it('getStatus keeps POST_REG_NOT_INITIATED for a missing or deactivated user', async () => {
      mockPrismaService.users_pr.findUnique.mockReset().mockResolvedValue(null);
      mockPrismaService.users.findUnique.mockResolvedValue({ active: false });

      await expect(service.getStatus(userId, ownerActor)).rejects.toMatchObject(
        { code: ErrorCode.POST_REG_NOT_INITIATED },
      );

      mockPrismaService.users.findUnique.mockResolvedValue(null);
      await expect(service.getStatus(userId, ownerActor)).rejects.toMatchObject(
        { code: ErrorCode.POST_REG_NOT_INITIATED },
      );
      expect(mockPrismaService.users_pr.createMany).not.toHaveBeenCalled();
    });

    it('getStatus does not touch the row of a user that already has one', async () => {
      await service.getStatus('target-user-1', ownerActor);

      expect(mockPrismaService.users.findUnique).not.toHaveBeenCalled();
      expect(mockPrismaService.users_pr.createMany).not.toHaveBeenCalled();
    });

    it('step 1 completes for a user without a row', async () => {
      givenNoRow();
      // 1st lookup: photo check; 2nd: users.active check inside ensure.
      mockPrismaService.users.findUnique
        .mockResolvedValueOnce({ user_image: 'profile.jpg' })
        .mockResolvedValueOnce({ active: true });

      const result = await service.completeStep1(userId, ownerActor);

      expect(result).toMatchObject({ status: 'success' });
      expect(mockPrismaService.users_pr.createMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.users_pr.update).toHaveBeenCalledWith({
        where: { user_id: userId },
        data: { profile_picture_complete: true },
      });
    });

    it('step 1 still requires the photo before creating anything', async () => {
      givenNoRow();
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_image: null,
      });

      await expect(
        service.completeStep1(userId, ownerActor),
      ).rejects.toMatchObject({ code: ErrorCode.POST_REG_PHOTO_REQUIRED });
      expect(mockPrismaService.users_pr.createMany).not.toHaveBeenCalled();
    });

    it('step 2 completes for a user without a row', async () => {
      givenNoRow();
      mockPrismaService.users.findUnique
        .mockResolvedValueOnce({
          gender: 'M',
          birthday: new Date('2009-03-15'),
          baptism: true,
        })
        .mockResolvedValueOnce({ active: true });
      mockPrismaService.emergency_contacts.count.mockResolvedValue(1);

      await service.completeStep2(userId, ownerActor);

      expect(mockPrismaService.users_pr.createMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.users_pr.update).toHaveBeenCalledWith({
        where: { user_id: userId },
        data: { personal_info_complete: true },
      });
    });

    it('step 3 creates the row inside the transaction before the final update', async () => {
      givenNoRow(transactionMock as never);
      transactionMock.users.findUnique.mockResolvedValue({
        active: true,
        birthday: new Date('2016-01-01'),
      });

      const result = await service.completeStep3(
        userId,
        {
          country_id: 1,
          union_id: 2,
          local_field_id: 3,
          club_section_id: 10,
          class_id: 5,
        },
        ownerActor,
      );

      expect(result).toMatchObject({ status: 'success' });
      expect(transactionMock.users_pr.createMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.users_pr.createMany).not.toHaveBeenCalled();
      expect(transactionMock.users_pr.update).toHaveBeenCalledWith({
        where: { user_id: userId },
        data: {
          club_selection_complete: true,
          complete: true,
          date_completed: expect.any(Date),
        },
      });
    });

    it('step 3 for a deactivated user fails before any club write', async () => {
      transactionMock.users_pr.findUnique.mockResolvedValue(null);
      transactionMock.users.findUnique.mockResolvedValue({ active: false });

      await expect(
        service.completeStep3(
          userId,
          {
            country_id: 1,
            union_id: 2,
            local_field_id: 3,
            club_section_id: 10,
          },
          ownerActor,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.POST_REG_NOT_INITIATED });
      expect(
        transactionMock.club_role_assignments.create,
      ).not.toHaveBeenCalled();
    });

    it('guardian-only exit creates the row for a user without one', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        birthday: new Date('1985-05-10'),
        country_id: 1,
        account: [{ id: 'acc-1' }],
      });
      givenNoRow(transactionMock as never);
      transactionMock.users.findUnique.mockResolvedValue({ active: true });

      const result = await service.completeGuardianOnly(
        userId,
        {},
        { actorUserId: userId, isOwner: true },
      );

      expect(result).toMatchObject({ data: { mode: 'guardian_only' } });
      expect(transactionMock.users_pr.createMany).toHaveBeenCalledTimes(1);
      expect(transactionMock.users_pr.update).toHaveBeenCalled();
    });

    it('cancel pending request ensures the row before resetting it', async () => {
      givenNoRow();
      mockPrismaService.users.findUnique.mockResolvedValue({ active: true });
      mockMembershipRequestsService.cancelPendingForUser.mockResolvedValue({});

      await service.cancelPendingMembershipRequest(userId, ownerActor);

      expect(mockPrismaService.users_pr.createMany).toHaveBeenCalledTimes(1);
      expect(
        mockMembershipRequestsService.cancelPendingForUser,
      ).toHaveBeenCalled();
    });
  });
});
