import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ErrorCode } from '../common/errors/error-codes';
import { user_approval_status } from '@prisma/client';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import { BetterAuthService } from '../better-auth/better-auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminListUsersQueryDto, CreateAdminUserDto } from './dto';
import { AdminUsersService } from './admin-users.service';
import { AppConflictException, AppForbiddenException } from '../common/errors/app.exception';

describe('AdminUsersService', () => {
  let service: AdminUsersService;

  const mockPrismaService = {
    users: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    roles: {
      findFirst: jest.fn(),
    },
    users_roles: {
      create: jest.fn(),
    },
    ecclesiastical_years: {
      findFirst: jest.fn(),
    },
    enrollments: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockFileStorageService = {
    getSignedDownloadUrl: jest.fn((_bucket: unknown, value: string) =>
      Promise.resolve(value),
    ),
  };

  const mockAuthorizationContextService = {
    resolveUserAuthorization: jest.fn(),
  };

  const mockBetterAuthService = {
    createUser: jest.fn(),
    resetPasswordForEmail: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: FILE_STORAGE_SERVICE,
          useValue: mockFileStorageService,
        },
        {
          provide: AuthorizationContextService,
          useValue: mockAuthorizationContextService,
        },
        {
          provide: BetterAuthService,
          useValue: mockBetterAuthService,
        },
      ],
    }).compile();

    service = module.get<AdminUsersService>(AdminUsersService);

    mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(null);
    mockPrismaService.enrollments.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const buildResolvedAuthorization = (globalPermissions: string[]) => ({
    profile: {},
    post_register_complete: false,
    authorization: {
      grants: {
        global_roles: [
          {
            role_name: 'admin',
            permissions: globalPermissions,
            scope: {},
          },
        ],
        club_assignments: [],
      },
      active_assignment: { assignment_id: null },
      effective: {
        permissions: globalPermissions,
        scope: {
          global: {},
          club: null,
        },
      },
    },
    legacy: {
      roles: ['admin'],
      permissions: globalPermissions,
      club: null,
      club_context: {
        active_assignment_id: null,
        active: null,
        available: [],
      },
    },
  });

  const buildAdminDetailRecord = (): any => ({
    user_id: 'user-1',
    email: 'user1@example.com',
    name: 'Maria',
    paternal_last_name: 'Lopez',
    maternal_last_name: 'Diaz',
    gender: 'Femenino',
    birthday: new Date('2010-10-01'),
    blood: 'A_POSITIVE',
    baptism: false,
    baptism_date: null,
    user_image: null,
    active: true,
    access_app: true,
    access_panel: false,
    country_id: 1,
    union_id: 2,
    local_field_id: 3,
    created_at: new Date('2026-01-01'),
    modified_at: new Date('2026-01-05'),
    countries: { country_id: 1, name: 'Mexico' },
    unions: { union_id: 2, name: 'UMS' },
    local_fields: { local_field_id: 3, union_id: 2, name: 'Campo Sur' },
    users_roles: [{ role_id: 'r1', roles: { role_name: 'user' } }],
    users_pr: {
      complete: false,
      profile_picture_complete: true,
      personal_info_complete: false,
      club_selection_complete: false,
      date_completed: null,
    },
    enrollments: [],
    club_role_assignments: [],
    emergency_contact: [
      {
        emergency_id: 91,
        name: 'Ana Tutor',
        phone: '555-1111',
        primary: true,
        relationship_type_id: 4,
      },
    ],
    legal_representative: {
      id: 41,
      representative_user_id: null,
      relationship_type_id: 8,
      name: 'Carlos',
      paternal_last_name: 'Tutor',
      maternal_last_name: 'Perez',
      phone: '555-2222',
    },
    users_allergies: [
      {
        allergy_id: 1,
        allergies: { name: 'Peanuts' },
      },
    ],
    users_diseases: [
      {
        disease_id: 2,
        diseases: { name: 'Asthma' },
      },
    ],
    users_medicines: [
      {
        medicine_id: 3,
        medicines: { name: 'Salbutamol' },
      },
    ],
  });

  const buildTrajectoryClass = () => ({
    enrollment_id: 55,
    class_id: 9,
    ecclesiastical_year_id: 2026,
    advanced_status: false,
    active: true,
    enrollment_date: new Date('2026-01-10T00:00:00.000Z'),
    investiture_status: 'IN_PROGRESS',
    investiture_date: null,
    classes: {
      name: 'Explorador',
    },
    ecclesiastical_year: {
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
    },
  });

  const buildEnrollmentCandidate = (enrollmentId: number) => ({
    enrollment_id: enrollmentId,
    ecclesiastical_year_id: 2026,
    class_id: 7,
    enrollment_date: new Date('2026-01-05T10:00:00.000Z'),
    investiture_status: 'IN_PROGRESS',
    submitted_for_validation: false,
    submitted_at: null,
    validated_by: null,
    validated_at: null,
    rejection_reason: null,
    investiture_date: null,
    advanced_status: false,
    locked_for_validation: false,
    cross_type_enrollment: false,
    active: true,
    classes: {
      name: 'Amigo',
    },
  });

  const buildListQuery = (
    overrides: Partial<AdminListUsersQueryDto> = {},
  ): AdminListUsersQueryDto => ({
    page: 1,
    limit: 20,
    skip: 0,
    take: 20,
    ...overrides,
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listUsers', () => {
    it('should allow super-admin with ALL scope', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-super',
        union_id: null,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'super-admin' } }],
      });
      mockPrismaService.users.findMany.mockResolvedValue([
        {
          user_id: 'u1',
          email: 'u1@example.com',
          name: 'Juan',
          paternal_last_name: 'Pérez',
          maternal_last_name: 'García',
          user_image: 'https://cdn.example.com/users/u1.jpg',
          active: true,
          access_app: true,
          access_panel: false,
          country_id: 1,
          union_id: 10,
          local_field_id: 20,
          created_at: new Date('2026-01-01'),
          countries: { country_id: 1, name: 'México' },
          unions: { union_id: 10, name: 'UMN' },
          local_fields: { local_field_id: 20, union_id: 10, name: 'Campo A' },
          users_roles: [{ roles: { role_name: 'user' } }],
          users_pr: [
            {
              complete: true,
              profile_picture_complete: true,
              personal_info_complete: true,
              club_selection_complete: true,
            },
          ],
        },
      ]);
      mockPrismaService.users.count.mockResolvedValue(1);

      const result = await service.listUsers('actor-super', buildListQuery());

      expect(result.meta.scope.type).toBe('ALL');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].user_image).toBe(
        'https://cdn.example.com/users/u1.jpg',
      );
      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );
    });

    it('should enforce UNION scope for admin with union_id', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-admin',
        union_id: 7,
        local_field_id: 99,
        users_roles: [{ roles: { role_name: 'admin' } }],
      });
      mockPrismaService.users.findMany.mockResolvedValue([]);
      mockPrismaService.users.count.mockResolvedValue(0);

      await service.listUsers('actor-admin', buildListQuery());

      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { union_id: 7 },
        }),
      );
    });

    it('should enforce LOCAL_FIELD scope for coordinator', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-coordinator',
        union_id: 5,
        local_field_id: 11,
        users_roles: [{ roles: { role_name: 'coordinator' } }],
      });
      mockPrismaService.users.findMany.mockResolvedValue([]);
      mockPrismaService.users.count.mockResolvedValue(0);

      await service.listUsers('actor-coordinator', buildListQuery());

      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { local_field_id: 11 },
        }),
      );
    });

    it('should reject admin without union_id/local_field_id', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-admin',
        union_id: null,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'admin' } }],
      });

      await expect(
        service.listUsers('actor-admin', buildListQuery()),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
    });

    it('should reject coordinator without local_field_id', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-coordinator',
        union_id: 5,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'coordinator' } }],
      });

      await expect(
        service.listUsers('actor-coordinator', buildListQuery()),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
    });

    it('should enforce UNION scope for assistant-admin with union_id', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-assistant-admin',
        union_id: 12,
        local_field_id: 44,
        users_roles: [{ roles: { role_name: 'assistant-admin' } }],
      });
      mockPrismaService.users.findMany.mockResolvedValue([]);
      mockPrismaService.users.count.mockResolvedValue(0);

      await service.listUsers('actor-assistant-admin', buildListQuery());

      expect(mockPrismaService.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { union_id: 12 },
        }),
      );
    });

    it('should reject assistant-admin without union_id/local_field_id', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-assistant-admin',
        union_id: null,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'assistant-admin' } }],
      });

      await expect(
        service.listUsers('actor-assistant-admin', buildListQuery()),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_SCOPE_MISSING });
    });
  });

  describe('getUserById', () => {
    it('should return user detail in scope', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-super',
        union_id: null,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'super-admin' } }],
      });
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization(['users:read_detail']),
      );

      mockPrismaService.users.findFirst.mockResolvedValue({
        user_id: 'user-1',
        email: 'user1@example.com',
        name: 'María',
        paternal_last_name: 'López',
        maternal_last_name: 'Díaz',
        gender: 'Femenino',
        birthday: new Date('2010-10-01'),
        blood: 'A_POSITIVE',
        baptism: false,
        baptism_date: null,
        user_image: null,
        active: true,
        access_app: true,
        access_panel: false,
        country_id: 1,
        union_id: 2,
        local_field_id: 3,
        created_at: new Date('2026-01-01'),
        modified_at: new Date('2026-01-05'),
        countries: { country_id: 1, name: 'México' },
        unions: { union_id: 2, name: 'UMS' },
        local_fields: { local_field_id: 3, union_id: 2, name: 'Campo Sur' },
        users_roles: [{ role_id: 'r1', roles: { role_name: 'user' } }],
        users_pr: [
          {
            complete: false,
            profile_picture_complete: true,
            personal_info_complete: false,
            club_selection_complete: false,
            date_completed: null,
          },
        ],
        enrollments: [],
        club_role_assignments: [],
        emergency_contact: [],
        legal_representative: null,
      });

      const result = await service.getUserById('actor-super', 'user-1');

      expect(result.user_id).toBe('user-1');
      expect(result.roles).toEqual(['user']);
      expect(result.scope.type).toBe('ALL');
      expect(result.current_operational_enrollment).toBeNull();
      expect(result.trajectory_classes).toEqual([]);
      expect(result.classes).toEqual([]);
    });

    it('should throw NotFoundException when user is outside scope', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-admin',
        union_id: 4,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'admin' } }],
      });
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization(['users:read_detail']),
      );
      mockPrismaService.users.findFirst.mockResolvedValue(null);

      await expect(
        service.getUserById('actor-admin', 'user-outside-scope'),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_USER_NOT_FOUND });

      const findFirstCalls = mockPrismaService.users.findFirst.mock
        .calls as Array<[unknown?]>;
      const findFirstArgs = findFirstCalls[0]?.[0] as
        | {
            where?: {
              AND?: Array<{ user_id?: string; union_id?: number }>;
            };
          }
        | undefined;

      expect(findFirstArgs?.where?.AND).toEqual(
        expect.arrayContaining([
          { user_id: 'user-outside-scope' },
          { union_id: 4 },
        ]),
      );
    });

    describe('sensitive subresource pruning', () => {
      const actor = {
        user_id: 'actor-admin',
        union_id: 2,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'admin' } }],
      };

      beforeEach(() => {
        mockPrismaService.users.findUnique.mockResolvedValue(actor);
        mockPrismaService.users.findFirst.mockResolvedValue(
          buildAdminDetailRecord(),
        );
      });

      it.each([
        ['health', ['health:read'], 'health'],
        [
          'emergency_contacts',
          ['emergency_contacts:read'],
          'emergency_contacts',
        ],
        [
          'legal_representative',
          ['legal_representative:read'],
          'legal_representative',
        ],
        ['post_registration', ['post_registration:read'], 'post_registration'],
      ])(
        'should expose only %s block for fine-grained readers',
        async (_family, permissions, visibleBlock) => {
          mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
            buildResolvedAuthorization(permissions),
          );

          const result = await service.getUserById('actor-admin', 'user-1');

          expect(result.health).toEqual(
            visibleBlock === 'health' ? definedHealth() : null,
          );
          expect(result.emergency_contacts).toEqual(
            visibleBlock === 'emergency_contacts'
              ? buildAdminDetailRecord().emergency_contact
              : null,
          );
          expect(result.legal_representative).toEqual(
            visibleBlock === 'legal_representative'
              ? buildAdminDetailRecord().legal_representative
              : null,
          );
          expect(result.post_registration).toEqual(
            visibleBlock === 'post_registration'
              ? definedPostRegistration()
              : null,
          );
        },
      );

      it('should preserve transitional legacy compatibility for users:read_detail', async () => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          buildResolvedAuthorization(['users:read_detail']),
        );

        const result = await service.getUserById('actor-admin', 'user-1');

        expect(result.health).toEqual(definedHealth());
        expect(result.emergency_contacts).toEqual(
          buildAdminDetailRecord().emergency_contact,
        );
        expect(result.legal_representative).toEqual(
          buildAdminDetailRecord().legal_representative,
        );
        expect(result.post_registration).toEqual(definedPostRegistration());
      });

      it('should prune sensitive blocks when actor lacks fine and legacy detail permissions', async () => {
        mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
          buildResolvedAuthorization(['users:read']),
        );

        const result = await service.getUserById('actor-admin', 'user-1');

        expect(result.health).toBeNull();
        expect(result.emergency_contacts).toBeNull();
        expect(result.legal_representative).toBeNull();
        expect(result.post_registration).toBeNull();
      });
    });

    it('should map operational and trajectory sources with legacy classes alias', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-super',
        union_id: null,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'super-admin' } }],
      });
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization(['users:read_detail']),
      );

      const userRecord = buildAdminDetailRecord();
      userRecord.enrollments = [buildTrajectoryClass()];
      mockPrismaService.users.findFirst.mockResolvedValue(userRecord);

      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
      });
      mockPrismaService.enrollments.findMany.mockResolvedValue([
        buildEnrollmentCandidate(9001),
      ]);

      const result = await service.getUserById('actor-super', 'user-1');

      expect(result.current_operational_enrollment).toEqual(
        expect.objectContaining({
          enrollment_id: 9001,
          ecclesiastical_year_id: 2026,
          class_id: 7,
          class_name: 'Amigo',
        }),
      );
      expect(result.trajectory_classes).toEqual([
        {
          enrollment_id: 55,
          class_id: 9,
          class_name: 'Explorador',
          ecclesiastical_year_id: 2026,
          advanced: false,
          current_class: true,
          investiture_status: 'IN_PROGRESS',
          enrollment_date: new Date('2026-01-10T00:00:00.000Z'),
        },
      ]);
      expect(result.classes).toEqual(result.trajectory_classes);
    });

    it('should return null operational enrollment when active year has no enrollment candidates', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-super',
        union_id: null,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'super-admin' } }],
      });
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization(['users:read_detail']),
      );

      const userRecord = buildAdminDetailRecord();
      userRecord.enrollments = [buildTrajectoryClass()];
      mockPrismaService.users.findFirst.mockResolvedValue(userRecord);

      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
      });
      mockPrismaService.enrollments.findMany.mockResolvedValue([]);

      const result = await service.getUserById('actor-super', 'user-1');

      expect(result.current_operational_enrollment).toBeNull();
      expect(result.trajectory_classes).toHaveLength(1);
      expect(result.classes).toEqual(result.trajectory_classes);
    });

    it('should return trajectory item with null class_name when linked class metadata is missing', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-super',
        union_id: null,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'super-admin' } }],
      });
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization(['users:read_detail']),
      );

      const userRecord = buildAdminDetailRecord();
      userRecord.enrollments = [
        {
          ...buildTrajectoryClass(),
          classes: null,
        },
      ];
      mockPrismaService.users.findFirst.mockResolvedValue(userRecord);

      const result = await service.getUserById('actor-super', 'user-1');

      expect(result.current_operational_enrollment).toBeNull();
      expect(result.trajectory_classes[0]).toEqual(
        expect.objectContaining({
          class_name: null,
          class_id: 9,
        }),
      );
    });

    it('should return null operational enrollment and warn on enrollment conflicts', async () => {
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'actor-super',
        union_id: null,
        local_field_id: null,
        users_roles: [{ roles: { role_name: 'super-admin' } }],
      });
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        buildResolvedAuthorization(['users:read_detail']),
      );

      const userRecord = buildAdminDetailRecord();
      userRecord.enrollments = [buildTrajectoryClass()];
      mockPrismaService.users.findFirst.mockResolvedValue(userRecord);

      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
      });
      mockPrismaService.enrollments.findMany.mockResolvedValue([
        buildEnrollmentCandidate(9001),
        buildEnrollmentCandidate(9002),
      ]);

      const warnSpy = jest
        .spyOn<any, any>(service['logger'], 'warn')
        .mockImplementation(() => undefined);

      const result = await service.getUserById('actor-super', 'user-1');

      expect(result.current_operational_enrollment).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'formative_read_model_conflict',
          userId: 'user-1',
          ecclesiasticalYearId: 2026,
          enrollmentIds: [9001, 9002],
          source: 'admin-user-detail',
        }),
      );

      warnSpy.mockRestore();
    });
  });

  describe('updateUserApproval', () => {
    it('should approve a user, clear rejection reason, and activate access', async () => {
      const expected = {
        user_id: 'user-1',
        approval_status: user_approval_status.approved,
        rejection_reason: null,
        active: true,
      };
      mockPrismaService.users.update.mockResolvedValue(expected);

      const result = await service.updateUserApproval('user-1', {
        approved: true,
      });

      expect(mockPrismaService.users.update).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
        data: {
          approval_status: user_approval_status.approved,
          rejection_reason: null,
          active: true,
        },
      });
      expect(result).toEqual(expected);
    });

    it('should reject a user, persist rejection reason, and deactivate access', async () => {
      const expected = {
        user_id: 'user-1',
        approval_status: user_approval_status.rejected,
        rejection_reason: 'Incomplete profile',
        active: false,
      };
      mockPrismaService.users.update.mockResolvedValue(expected);

      const result = await service.updateUserApproval('user-1', {
        approved: false,
        rejection_reason: 'Incomplete profile',
      });

      expect(mockPrismaService.users.update).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
        data: {
          approval_status: user_approval_status.rejected,
          rejection_reason: 'Incomplete profile',
          active: false,
        },
      });
      expect(result).toEqual(expected);
    });

    it('should flip a pending user to approved: sets approval_status=approved, active=true, rejection_reason=null', async () => {
      // Simulates the transition triggered by PATCH /admin/users/:id/approval
      // with { approved: true } — the canonical approval endpoint.
      const pendingUser = {
        user_id: 'pending-user',
        approval_status: user_approval_status.pending,
        rejection_reason: null,
        active: false,
      };
      const approvedUser = {
        ...pendingUser,
        approval_status: user_approval_status.approved,
        active: true,
      };
      mockPrismaService.users.update.mockResolvedValue(approvedUser);

      const result = await service.updateUserApproval(pendingUser.user_id, {
        approved: true,
      });

      // Verify the Prisma payload atomically updates both status + active
      expect(mockPrismaService.users.update).toHaveBeenCalledWith({
        where: { user_id: 'pending-user' },
        data: {
          approval_status: user_approval_status.approved,
          rejection_reason: null,
          active: true,
        },
      });

      // Verify the returned record reflects the approved state
      expect(result.approval_status).toBe(user_approval_status.approved);
      expect(result.active).toBe(true);
      expect(result.rejection_reason).toBeNull();
    });

    it('should not pass legacy approval/approved fields to Prisma via updateUser', async () => {
      // Guards against clients that send { approval: 1, approved: true }
      // alongside approval_status — only known Prisma columns must be forwarded.
      const dto = {
        approval_status: user_approval_status.approved,
        active: true,
      };
      const expected = { user_id: 'user-1', ...dto };
      mockPrismaService.users.update.mockResolvedValue(expected);

      await service.updateUser('user-1', dto);

      const firstCallArg = mockPrismaService.users.update.mock.calls[0][0];
      const callData = (firstCallArg as { data: Record<string, unknown> }).data;

      // Prisma payload must NOT contain unknown fields
      expect(callData).not.toHaveProperty('approval');
      expect(callData).not.toHaveProperty('approved');
      expect(callData).toMatchObject({
        approval_status: user_approval_status.approved,
        active: true,
      });
    });
  });

  describe('updateUser', () => {
    it('should forward partial admin updates to prisma', async () => {
      const dto = {
        active: false,
        access_panel: true,
        approval_status: user_approval_status.approved,
      };
      const expected = { user_id: 'user-1', ...dto };
      mockPrismaService.users.update.mockResolvedValue(expected);

      const result = await service.updateUser('user-1', dto);

      expect(mockPrismaService.users.update).toHaveBeenCalledWith({
        where: { user_id: 'user-1' },
        data: dto,
      });
      expect(result).toEqual(expected);
    });
  });

  describe('createAdminUser', () => {
    const buildCreateDto = (overrides: Partial<CreateAdminUserDto> = {}): CreateAdminUserDto => ({
      name: 'Juan',
      paternal_last_name: 'Pérez',
      maternal_last_name: 'García',
      email: 'juan.perez@example.com',
      role: 'director-lf',
      country_id: 1,
      union_id: 2,
      local_field_id: 10,
      ...overrides,
    });

    const adminActorRoles = [{ roles: { role_name: 'admin' } }];

    beforeEach(() => {
      // Default happy-path stubs
      mockPrismaService.users.findUnique
        // First call: email uniqueness check → not found
        .mockResolvedValueOnce(null)
        // Second call: actor's role resolution
        .mockResolvedValueOnce({ users_roles: adminActorRoles });

      mockPrismaService.roles.findFirst.mockResolvedValue({
        role_id: 'role-uuid-lf',
        role_name: 'director-lf',
      });

      mockBetterAuthService.createUser.mockResolvedValue({
        user: { id: 'new-user-uuid', email: 'juan.perez@example.com' },
        session: {},
        accessToken: 'ignored',
      });

      // $transaction executes the array of operations
      mockPrismaService.$transaction.mockImplementation(
        (ops: Promise<unknown>[]) => Promise.all(ops),
      );
      mockPrismaService.users.update.mockResolvedValue({});
      mockPrismaService.users_roles.create.mockResolvedValue({});

      mockBetterAuthService.resetPasswordForEmail.mockResolvedValue(undefined);
    });

    it('should create user, assign role, send invite and return user_id + email + invite_email_sent=true', async () => {
      const dto = buildCreateDto();

      const result = await service.createAdminUser('actor-admin-uuid', dto);

      expect(result.user_id).toBe('new-user-uuid');
      expect(result.email).toBe('juan.perez@example.com');
      expect(result.invite_email_sent).toBe(true);

      expect(mockBetterAuthService.createUser).toHaveBeenCalledWith(
        'juan.perez@example.com',
        expect.any(String), // temp password — opaque
        'Juan Pérez García',
      );
      expect(mockBetterAuthService.resetPasswordForEmail).toHaveBeenCalledWith(
        'juan.perez@example.com',
      );
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should throw ConflictException when email already exists', async () => {
      // Override: email uniqueness check finds existing user
      mockPrismaService.users.findUnique.mockReset();
      mockPrismaService.users.findUnique.mockResolvedValueOnce({
        user_id: 'existing-uuid',
      });

      await expect(
        service.createAdminUser('actor-admin-uuid', buildCreateDto()),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_EMAIL_ALREADY_IN_USE });

      expect(mockBetterAuthService.createUser).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when role does not exist in DB', async () => {
      mockPrismaService.roles.findFirst.mockResolvedValue(null);

      await expect(
        service.createAdminUser('actor-admin-uuid', buildCreateDto({ role: 'nonexistent-role' })),
      ).rejects.toThrow();

      expect(mockBetterAuthService.createUser).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when assistant-lf tries to create admin role', async () => {
      // Override: email ok, actor is assistant-lf
      mockPrismaService.users.findUnique.mockReset();
      mockPrismaService.users.findUnique
        .mockResolvedValueOnce(null) // email not found
        .mockResolvedValueOnce({ users_roles: [{ roles: { role_name: 'assistant-lf' } }] });

      await expect(
        service.createAdminUser('actor-lf-uuid', buildCreateDto({ role: 'admin' })),
      ).rejects.toMatchObject({ code: ErrorCode.GUARD_PERMISSION_DENIED });

      expect(mockBetterAuthService.createUser).not.toHaveBeenCalled();
    });

    it('should create user with invite_email_sent=false when EMAIL_ENABLED is not true', async () => {
      mockBetterAuthService.resetPasswordForEmail.mockRejectedValue(
        new ServiceUnavailableException('email disabled'),
      );

      const result = await service.createAdminUser('actor-admin-uuid', buildCreateDto());

      expect(result.user_id).toBe('new-user-uuid');
      expect(result.invite_email_sent).toBe(false);
      // User must still be created and role assigned
      expect(mockBetterAuthService.createUser).toHaveBeenCalled();
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });

    it('should build full_name without maternal_last_name when absent', async () => {
      const dto = buildCreateDto({ maternal_last_name: undefined });

      await service.createAdminUser('actor-admin-uuid', dto);

      expect(mockBetterAuthService.createUser).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'Juan Pérez', // no trailing space, no extra segment
      );
    });
  });

  // ── bulkCreateAdminUsers ─────────────────────────────────────────────────────

  describe('bulkCreateAdminUsers', () => {
    // Builds a minimal valid xlsx buffer with given data rows.
    // Row 1 is always the standard headers.
    const buildXlsxBuffer = (
      dataRows: (string | number | null)[][],
    ): Buffer => {
      // Dynamic import not possible in Jest without async, so use require.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const XLSX = require('xlsx') as typeof import('xlsx');
      const wb = XLSX.utils.book_new();
      const wsData = [
        [
          'email',
          'name',
          'paternal_last_name',
          'maternal_last_name',
          'role',
          'country_id',
          'union_id',
          'local_field_id',
        ],
        ...dataRows,
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, 'Usuarios');
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    };

    const XLSX_MIME =
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    const adminActorRolesForBulk = [{ roles: { role_name: 'admin' } }];

    beforeEach(() => {
      // Default stubs that mirror createAdminUser happy-path
      mockPrismaService.users.findUnique
        .mockResolvedValue(null) // email not found (first call)
        .mockResolvedValueOnce({ users_roles: adminActorRolesForBulk }); // actor roles

      mockPrismaService.roles.findFirst.mockResolvedValue({
        role_id: 'role-uuid',
        role_name: 'user',
      });

      mockBetterAuthService.createUser.mockResolvedValue({
        user: { id: 'new-uuid', email: 'test@example.com' },
        session: {},
        accessToken: 'ignored',
      });

      mockPrismaService.$transaction.mockImplementation(
        (ops: Promise<unknown>[]) => Promise.all(ops),
      );
      mockPrismaService.users.update.mockResolvedValue({});
      mockPrismaService.users_roles.create.mockResolvedValue({});
      mockBetterAuthService.resetPasswordForEmail.mockResolvedValue(undefined);
    });

    it('happy path: 3 rows, all succeed', async () => {
      // Provide sequential stubs: each row calls findUnique twice
      // (email check + actor lookup) and creates a user.
      mockPrismaService.users.findUnique.mockReset();
      mockBetterAuthService.createUser.mockReset();

      // Row 1
      mockPrismaService.users.findUnique.mockResolvedValueOnce(null); // email not found
      mockPrismaService.users.findUnique.mockResolvedValueOnce({ users_roles: adminActorRolesForBulk }); // actor
      mockBetterAuthService.createUser.mockResolvedValueOnce({ user: { id: 'uid-1', email: 'a@x.com' }, session: {} });

      // Row 2
      mockPrismaService.users.findUnique.mockResolvedValueOnce(null);
      mockPrismaService.users.findUnique.mockResolvedValueOnce({ users_roles: adminActorRolesForBulk });
      mockBetterAuthService.createUser.mockResolvedValueOnce({ user: { id: 'uid-2', email: 'b@x.com' }, session: {} });

      // Row 3
      mockPrismaService.users.findUnique.mockResolvedValueOnce(null);
      mockPrismaService.users.findUnique.mockResolvedValueOnce({ users_roles: adminActorRolesForBulk });
      mockBetterAuthService.createUser.mockResolvedValueOnce({ user: { id: 'uid-3', email: 'c@x.com' }, session: {} });

      mockPrismaService.roles.findFirst.mockResolvedValue({ role_id: 'r1', role_name: 'user' });

      const buffer = buildXlsxBuffer([
        ['a@x.com', 'Ana', 'Lopez', '', 'user', 1, 12, 34],
        ['b@x.com', 'Bob', 'Smith', '', 'user', 1, 12, 34],
        ['c@x.com', 'Carlos', 'Torres', '', 'user', 1, 12, 34],
      ]);

      const result = await service.bulkCreateAdminUsers(
        'actor-admin-uuid',
        buffer,
        XLSX_MIME,
      );

      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.results.every((r) => r.status === 'success')).toBe(true);
    });

    it('should mark second occurrence of same email as DUPLICATE_IN_FILE', async () => {
      mockPrismaService.users.findUnique.mockReset();
      mockBetterAuthService.createUser.mockReset();

      // Row 1 (duplicate@x.com — succeeds)
      mockPrismaService.users.findUnique.mockResolvedValueOnce(null);
      mockPrismaService.users.findUnique.mockResolvedValueOnce({ users_roles: adminActorRolesForBulk });
      mockBetterAuthService.createUser.mockResolvedValueOnce({ user: { id: 'uid-1', email: 'duplicate@x.com' }, session: {} });

      // Row 2 (unique@x.com — succeeds)
      mockPrismaService.users.findUnique.mockResolvedValueOnce(null);
      mockPrismaService.users.findUnique.mockResolvedValueOnce({ users_roles: adminActorRolesForBulk });
      mockBetterAuthService.createUser.mockResolvedValueOnce({ user: { id: 'uid-2', email: 'unique@x.com' }, session: {} });

      // Row 3 (duplicate@x.com again — should be caught before createAdminUser)

      mockPrismaService.roles.findFirst.mockResolvedValue({ role_id: 'r1', role_name: 'user' });

      const buffer = buildXlsxBuffer([
        ['duplicate@x.com', 'Ana', 'Lopez', '', 'user', '', '', ''],
        ['unique@x.com', 'Bob', 'Smith', '', 'user', '', '', ''],
        ['duplicate@x.com', 'Ana', 'Lopez2', '', 'user', '', '', ''],
      ]);

      const result = await service.bulkCreateAdminUsers(
        'actor-admin-uuid',
        buffer,
        XLSX_MIME,
      );

      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(1);

      const errorRow = result.results.find((r) => r.status === 'error');
      expect(errorRow?.error_code).toBe('DUPLICATE_IN_FILE');
      expect(errorRow?.row).toBe(4); // row 4 in the file (1 header + 3 data → row index 2+2)
    });

    it('should map AppConflictException(AUTH_EMAIL_ALREADY_IN_USE) to EMAIL_ALREADY_IN_USE error_code', async () => {
      mockPrismaService.users.findUnique.mockReset();
      mockBetterAuthService.createUser.mockReset();

      // Simulate createAdminUser throwing conflict
      mockPrismaService.users.findUnique
        .mockResolvedValueOnce({ user_id: 'existing' }); // email already exists

      mockPrismaService.roles.findFirst.mockResolvedValue({ role_id: 'r1', role_name: 'user' });

      const buffer = buildXlsxBuffer([
        ['existing@x.com', 'Ana', 'Lopez', '', 'user', '', '', ''],
      ]);

      const result = await service.bulkCreateAdminUsers(
        'actor-admin-uuid',
        buffer,
        XLSX_MIME,
      );

      expect(result.total).toBe(1);
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.results[0].error_code).toBe('EMAIL_ALREADY_IN_USE');
    });

    it('should throw AppBadRequestException when file has more than 500 rows', async () => {
      const rows = Array.from({ length: 501 }, (_, i) => [
        `user${i}@x.com`,
        'Test',
        'User',
        '',
        'user',
        '',
        '',
        '',
      ]);
      const buffer = buildXlsxBuffer(rows);

      await expect(
        service.bulkCreateAdminUsers('actor-admin-uuid', buffer, XLSX_MIME),
      ).rejects.toMatchObject({ code: ErrorCode.ADMIN_BULK_TOO_MANY_ROWS });
    });
  });
});

function definedHealth() {
  return {
    blood: 'A_POSITIVE',
    allergies: [{ allergy_id: 1, name: 'Peanuts' }],
    diseases: [{ disease_id: 2, name: 'Asthma' }],
    medicines: [{ medicine_id: 3, name: 'Salbutamol' }],
  };
}

function definedPostRegistration() {
  return {
    complete: false,
    profile_picture_complete: true,
    personal_info_complete: false,
    club_selection_complete: false,
    date_completed: null,
  };
}
