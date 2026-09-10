import { Test, TestingModule } from '@nestjs/testing';
import { ClubsService } from './clubs.service';
import { PrismaService } from '../prisma/prisma.service';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthorizationContextVersionService } from '../common/authorization/authorization-context-version.service';
import { ErrorCode } from '../common/errors/error-codes';
import { EcclesiasticalYearService } from '../common/services/ecclesiastical-year.service';
import { AppNotFoundException } from '../common/errors/app.exception';

describe('ClubsService', () => {
  let service: ClubsService;

  const mockPrismaService = {
    clubs: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    club_types: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    club_sections: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
    },
    club_role_assignments: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    roles: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    role_slot_limits: {
      findUnique: jest.fn(),
    },
    activities: {
      findMany: jest.fn(),
    },
    role_assignment_requests: {
      count: jest.fn(),
    },
    unit_members: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    weekly_records: {
      findMany: jest.fn(),
    },
    ecclesiastical_years: {
      findFirst: jest.fn(),
    },
    local_fields: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    districts: {
      findUnique: jest.fn(),
    },
    churches: {
      findUnique: jest.fn(),
    },
    enrollments: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockFileStorageService = {
    getSignedDownloadUrl: jest.fn(
      async (_bucket: unknown, value: string) => value,
    ),
  };

  const mockAuditLogsService = {
    recordEvent: jest.fn().mockResolvedValue(undefined),
    listByClub: jest.fn(),
  };

  const mockAuthorizationContextService = {
    invalidateUserAuthorizationCache: jest.fn(),
    hasAnyGlobalRole: jest.fn(),
    canManageClub: jest.fn(),
    resolveUserAuthorization: jest.fn(),
  };

  const mockAuthorizationContextVersionService = {
    bump: jest.fn().mockResolvedValue(1n),
    bumpOrdered: jest.fn().mockResolvedValue(undefined),
    bumpMany: jest.fn().mockResolvedValue(0),
  };

  const mockEcclesiasticalYearService = {
    getCurrentYear: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
        {
          provide: AuthorizationContextService,
          useValue: mockAuthorizationContextService,
        },
        {
          provide: AuthorizationContextVersionService,
          useValue: mockAuthorizationContextVersionService,
        },
        {
          provide: NotificationsService,
          useValue: {
            sendSilentToSection: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AuditLogsService,
          useValue: mockAuditLogsService,
        },
        {
          provide: EcclesiasticalYearService,
          useValue: mockEcclesiasticalYearService,
        },
      ],
    }).compile();

    service = module.get<ClubsService>(ClubsService);
    mockPrismaService.$transaction.mockImplementation(
      (callback: (tx: typeof mockPrismaService) => unknown) =>
        callback(mockPrismaService),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated clubs', async () => {
      const mockClubs = [{ club_id: 1, name: 'Club Central', active: true }];

      mockPrismaService.clubs.findMany.mockResolvedValue(mockClubs);
      mockPrismaService.clubs.count.mockResolvedValue(1);

      const result = await service.findAll();

      expect(result.data).toEqual(mockClubs);
      expect(result.meta.total).toBe(1);
    });

    it('should filter by local field', async () => {
      mockPrismaService.clubs.findMany.mockResolvedValue([]);
      mockPrismaService.clubs.count.mockResolvedValue(0);

      await service.findAll({ localFieldId: 5 });

      expect(mockPrismaService.clubs.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            local_field_id: 5,
          }),
        }),
      );
    });

    it('intersects GET /clubs with director-union scope even if home local_field is set', async () => {
      mockPrismaService.clubs.findMany.mockResolvedValue([]);
      mockPrismaService.clubs.count.mockResolvedValue(0);
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        {
          authorization: {
            grants: {
              global_roles: [
                { role_name: 'director-union', permissions: [], scope: {} },
              ],
            },
            effective: {
              scope: {
                global: {
                  union: { id: 2 },
                  local_field: { id: 9 },
                },
              },
            },
          },
        },
      );

      await service.findAll({}, undefined, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');

      expect(mockPrismaService.clubs.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [{ local_fields: { union_id: 2 } }, {}],
          },
        }),
      );
    });

    it('403s when a territorial actor filters by a local field outside scope', async () => {
      mockAuthorizationContextService.resolveUserAuthorization.mockResolvedValue(
        {
          authorization: {
            grants: {
              global_roles: [
                { role_name: 'director-lf', permissions: [], scope: {} },
              ],
            },
            effective: {
              scope: {
                global: {
                  local_field: { id: 9 },
                },
              },
            },
          },
        },
      );

      await expect(
        service.findAll({ localFieldId: 4 }, undefined, 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111'),
      ).rejects.toMatchObject({
        code: ErrorCode.GUARD_PERMISSION_DENIED,
      });
      expect(mockPrismaService.clubs.findMany).not.toHaveBeenCalled();
    });

    it('skips territorial resolve for non-uuid stub JWTs', async () => {
      mockPrismaService.clubs.findMany.mockResolvedValue([]);
      mockPrismaService.clubs.count.mockResolvedValue(0);

      await service.findAll({}, undefined, 'clubs-e2e-user');

      expect(
        mockAuthorizationContextService.resolveUserAuthorization,
      ).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return club by id', async () => {
      const mockClub = { club_id: 1, name: 'Club Central' };
      mockPrismaService.clubs.findUnique.mockResolvedValue(mockClub);

      const result = await service.findOne(1);

      expect(result).toEqual(mockClub);
    });

    it('should throw NotFoundException when club not found', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toMatchObject({
        code: ErrorCode.CLUB_NOT_FOUND,
      });
    });
  });

  describe('create', () => {
    it('should create a new club with catalog sections', async () => {
      const createDto = {
        name: 'Nuevo Club',
        local_field_id: 1,
        districlub_type_id: 1,
        church_id: 1,
        enabled_club_type_ids: [1, 2],
      };

      const mockCreatedClub = { club_id: 1, name: 'Nuevo Club' };
      mockPrismaService.club_types.findMany.mockResolvedValue([
        { club_type_id: 1 },
        { club_type_id: 2 },
        { club_type_id: 3 },
      ]);
      mockPrismaService.clubs.create.mockResolvedValue(mockCreatedClub);
      mockPrismaService.club_sections.createMany.mockResolvedValue({ count: 3 });
      mockPrismaService.$transaction.mockImplementation(async (fn: any) =>
        fn(mockPrismaService),
      );

      const result = await service.create(createDto);

      expect(result).toEqual(mockCreatedClub);
      expect(mockPrismaService.club_sections.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            main_club_id: 1,
            club_type_id: 1,
            active: true,
          }),
          expect.objectContaining({
            main_club_id: 1,
            club_type_id: 2,
            active: true,
          }),
          expect.objectContaining({
            main_club_id: 1,
            club_type_id: 3,
            active: false,
          }),
        ],
      });
    });

    it('rejects create without enabled club types', async () => {
      await expect(
        service.create({
          name: 'Nuevo Club',
          local_field_id: 1,
          districlub_type_id: 1,
          church_id: 1,
          enabled_club_type_ids: [],
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_SECTION_TYPES_REQUIRED,
      });
    });

    it('rejects create when local_field_id is outside the actor territory', async () => {
      await expect(
        service.create(
          {
            name: 'Nuevo Club',
            local_field_id: 4,
            districlub_type_id: 1,
            church_id: 1,
            enabled_club_type_ids: [1],
          },
          {
            grants: {
              global_roles: [
                { role_name: 'director-lf', permissions: [], scope: {} },
              ],
              club_assignments: [],
              direct_permissions: [],
            },
            active_assignment: { assignment_id: null },
            effective: {
              permissions: [],
              scope: {
                global: { local_field: { id: 9 } },
                club: null,
              },
            },
          },
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.GUARD_PERMISSION_DENIED,
      });
      expect(mockPrismaService.club_types.findMany).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update an existing club', async () => {
      const mockClub = { club_id: 1, name: 'Club Original' };
      const updateDto = { name: 'Club Actualizado' };
      const mockUpdatedClub = { club_id: 1, name: 'Club Actualizado' };

      mockPrismaService.clubs.findUnique.mockResolvedValue(mockClub);
      mockPrismaService.clubs.update.mockResolvedValue(mockUpdatedClub);

      const result = await service.update(1, updateDto);

      expect(result.name).toBe('Club Actualizado');
    });
  });

  describe('remove', () => {
    it('should deactivate a club', async () => {
      const mockClub = { club_id: 1, name: 'Club', active: true };
      const mockDeactivated = { ...mockClub, active: false };

      mockPrismaService.clubs.findUnique.mockResolvedValue(mockClub);
      mockPrismaService.clubs.update.mockResolvedValue(mockDeactivated);

      const result = await service.remove(1);

      expect(result.active).toBe(false);
    });
  });

  describe('getSections', () => {
    it('should return sections with club_type name', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue({
        club_id: 10,
        name: 'Club Norte',
      });
      mockPrismaService.club_sections.findMany.mockResolvedValue([
        {
          club_section_id: 1,
          club_type_id: 1,
          active: true,
          club_types: { name: 'Aventureros' },
        },
        {
          club_section_id: 2,
          club_type_id: 2,
          active: true,
          club_types: { name: 'Conquistadores' },
        },
      ]);

      const result = await service.getSections(10);

      expect(mockPrismaService.club_sections.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { main_club_id: 10, active: true },
        }),
      );

      expect(result).toEqual([
        expect.objectContaining({
          club_section_id: 1,
          club_types: { name: 'Aventureros' },
        }),
        expect.objectContaining({
          club_section_id: 2,
          club_types: { name: 'Conquistadores' },
        }),
      ]);
    });
  });

  describe('createSection', () => {
    it('creates a section without a custom name', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue({
        club_id: 10,
        name: 'Club Norte',
      });
      mockPrismaService.club_types.findUnique.mockResolvedValue({
        club_type_id: 1,
        name: 'Aventureros',
        active: true,
      });
      mockPrismaService.club_sections.findFirst.mockResolvedValue(null);
      mockPrismaService.club_sections.create.mockResolvedValue({
        club_section_id: 7,
        main_club_id: 10,
        club_type_id: 1,
        club_types: { name: 'Aventureros' },
      });

      await service.createSection(10, {
        club_type_id: 1,
        souls_target: 0,
        fee: 0,
        meeting_day: [{ day: 'Sunday' }],
        meeting_time: [{ time: '09:00' }],
      });

      expect(mockPrismaService.club_sections.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            main_club_id: 10,
            club_type_id: 1,
            souls_target: 0,
            fee: 0,
          }),
        }),
      );
      expect(mockPrismaService.club_sections.create.mock.calls[0][0].data.name).toBeUndefined();
    });

    it('rejects creating a duplicate type for the same club', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue({
        club_id: 10,
        name: 'Club Norte',
      });
      mockPrismaService.club_types.findUnique.mockResolvedValue({
        club_type_id: 1,
        name: 'Aventureros',
        active: true,
      });
      mockPrismaService.club_sections.findFirst.mockResolvedValue({
        club_section_id: 7,
      });

      await expect(
        service.createSection(10, { club_type_id: 1 }),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_SECTION_TYPE_EXISTS,
      });
    });
  });

  describe('getMembers', () => {
    it('returns no current members when there is no current ecclesiastical year', async () => {
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        club_type_id: 2,
      });
      mockEcclesiasticalYearService.getCurrentYear.mockRejectedValue(
        new AppNotFoundException(ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND),
      );

      await expect(service.getMembers(7)).resolves.toEqual([]);
      expect(
        mockPrismaService.club_role_assignments.findMany,
      ).not.toHaveBeenCalled();
    });

    it('includes the active yearly class for the requested section type', async () => {
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        club_type_id: 2,
      });
      mockEcclesiasticalYearService.getCurrentYear.mockResolvedValue({
        year_id: 2026,
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        active: true,
      });
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        {
          assignment_id: 'assignment-1',
          user_id: 'user-1',
          club_section_id: 7,
          active: true,
          start_date: new Date('2026-01-01'),
          users: {
            user_id: 'user-1',
            name: 'Cley Rey',
            paternal_last_name: 'Ramírez',
            maternal_last_name: null,
            user_image: null,
            enrollments: [
              {
                enrollment_id: 55,
                class_id: 6,
                ecclesiastical_year_id: 2026,
                investiture_status: 'IN_PROGRESS',
                classes: {
                  class_id: 6,
                  name: 'Guía',
                  club_type_id: 2,
                },
              },
            ],
          },
          roles: {
            role_id: 'role-member',
            role_name: 'member',
            role_category: 'CLUB',
          },
        },
      ]);
      mockPrismaService.enrollments.findMany.mockResolvedValue([
        {
          user_id: 'user-1',
          enrollment_id: 99,
          class_id: 12,
          investiture_status: 'IN_PROGRESS',
          active: true,
          classes: {
            class_id: 12,
            name: 'Guía Mayor',
          },
        },
      ]);

      const result = await service.getMembers(7);

      expect(
        mockPrismaService.club_role_assignments.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            club_section_id: 7,
            active: true,
            status: 'active',
            ecclesiastical_year_id: 2026,
          },
          include: expect.objectContaining({
            users: expect.objectContaining({
              select: expect.objectContaining({
                enrollments: expect.objectContaining({
                  where: expect.objectContaining({
                    ecclesiastical_year_id: 2026,
                    active: true,
                    classes: { club_type_id: 2 },
                  }),
                }),
              }),
            }),
          }),
        }),
      );
      expect(result[0]).toMatchObject({
        current_class: {
          class_id: 6,
          name: 'Guía',
          enrollment_id: 55,
          ecclesiastical_year_id: 2026,
        },
        current_class_name: 'Guía',
        current_class_id: 6,
        enrollment_id: 55,
        class_counselor_eligible: true,
        guide_major_class: {
          class_id: 12,
          name: 'Guía Mayor',
          enrollment_id: 99,
          investiture_status: 'IN_PROGRESS',
          active: true,
        },
        users: {
          class_counselor_eligible: true,
          current_class: {
            name: 'Guía',
          },
        },
      });
      expect(result[0].users).not.toHaveProperty('enrollments');
    });
  });

  // ========================================
  // getClubLeadership
  // ========================================

  describe('getClubLeadership', () => {
    const makeAssignment = (
      roleName: string,
      sectionName: string | null = 'Conquistadores',
    ) => ({
      assignment_id: `assign-${roleName}`,
      user_id: 'user-uuid',
      start_date: new Date('2026-01-01'),
      users: {
        user_id: 'user-uuid',
        name: 'Juan',
        paternal_last_name: 'Perez',
        maternal_last_name: 'Lopez',
        user_image: null,
        email: 'juan@test.com',
      },
      roles: { role_name: roleName, role_category: 'CLUB' },
      club_sections: sectionName
        ? { club_types: { name: sectionName } }
        : null,
    });

    beforeEach(() => {
      // All pre-existing tests expect a resolved year so findMany is reached.
      mockEcclesiasticalYearService.getCurrentYear.mockResolvedValue({
        year_id: 2026,
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        active: true,
      });
    });

    it('happy path — groups director, deputies, secretaries and others', async () => {
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        makeAssignment('director'),
        makeAssignment('deputy-director'),
        makeAssignment('secretary'),
        makeAssignment('treasurer'),
      ]);

      const result = await service.getClubLeadership(1);

      expect(result.status).toBe('ok');
      expect(result.data.director?.role_name).toBe('director');
      expect(result.data.deputies).toHaveLength(1);
      expect(result.data.secretaries).toHaveLength(1);
      expect(result.data.others).toHaveLength(1);
      expect(result.data.others[0].role_name).toBe('treasurer');
    });

    it('club with no sections — returns null director and empty arrays', async () => {
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([]);

      const result = await service.getClubLeadership(99);

      expect(result.data.director).toBeNull();
      expect(result.data.deputies).toHaveLength(0);
      expect(result.data.secretaries).toHaveLength(0);
      expect(result.data.others).toHaveLength(0);
    });

    it('resolves profile image URL for members with user_image', async () => {
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        {
          ...makeAssignment('director'),
          users: {
            ...makeAssignment('director').users,
            user_image: 'path/to/img.jpg',
          },
        },
      ]);
      mockFileStorageService.getSignedDownloadUrl.mockResolvedValue(
        'https://cdn.example.com/signed',
      );

      const result = await service.getClubLeadership(1);

      expect(result.data.director?.user_image).toBe(
        'https://cdn.example.com/signed',
      );
    });
  });

  // ========================================
  // getClubOverview
  // ========================================

  describe('getClubOverview', () => {
    const mockSections = [
      { club_section_id: 1, active: true, souls_target: 20 },
      { club_section_id: 2, active: false, souls_target: 15 },
    ];

    beforeEach(() => {
      mockPrismaService.club_sections.findMany.mockResolvedValue(mockSections);
      mockPrismaService.activities.findMany.mockResolvedValue([]);
      mockPrismaService.role_assignment_requests.count.mockResolvedValue(0);
      mockPrismaService.unit_members.count.mockResolvedValue(0);
      mockPrismaService.unit_members.findMany.mockResolvedValue([]);
      mockPrismaService.weekly_records.findMany.mockResolvedValue([]);
      // Default: no active ecclesiastical year → investidos_year stays 0
      mockEcclesiasticalYearService.getCurrentYear.mockRejectedValue(
        new AppNotFoundException(ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND),
      );
      mockPrismaService.enrollments.count.mockResolvedValue(0);
    });

    it('happy path — returns all overview fields with correct structure', async () => {
      mockPrismaService.unit_members.count.mockResolvedValue(10);
      mockPrismaService.role_assignment_requests.count.mockResolvedValue(3);
      mockPrismaService.activities.findMany.mockResolvedValue([
        {
          activity_id: 1,
          name: 'Campamento',
          activity_date: new Date('2026-06-15'),
          activity_types: { code: 'CAMP' },
          club_sections: { club_types: { name: 'Conquistadores' } },
        },
      ]);

      const result = await service.getClubOverview(1);

      expect(result.status).toBe('ok');
      expect(result.data).toHaveProperty('attendance');
      expect(result.data).toHaveProperty('attendance_average');
      expect(result.data).toHaveProperty('score');
      expect(result.data.score).toHaveProperty('value');
      expect(result.data.score).toHaveProperty('grade');
      expect(result.data.score).toHaveProperty('breakdown');
      expect(result.data.upcoming_events).toHaveLength(1);
      expect(result.data.upcoming_events[0].activity_id).toBe(1);
      expect(result.data.funnel.pending_requests).toBe(3);
      expect(result.data.funnel.active_members).toBe(10);
      expect(result.data.funnel.investidos_year).toBe(0);
    });

    it('club with no sections — returns null attendance, score based on 0 values, empty events', async () => {
      mockPrismaService.club_sections.findMany.mockResolvedValue([]);

      const result = await service.getClubOverview(99);

      expect(result.data.attendance).toBeNull();
      expect(result.data.attendance_average).toBeNull();
      expect(result.data.upcoming_events).toHaveLength(0);
      expect(result.data.funnel.pending_requests).toBe(0);
      expect(result.data.funnel.active_members).toBe(0);
      expect(result.data.score.value).toBe(0);
    });

    it('club with no activities — upcoming_events is empty array', async () => {
      mockPrismaService.activities.findMany.mockResolvedValue([]);

      const result = await service.getClubOverview(1);

      expect(result.data.upcoming_events).toEqual([]);
    });

    it('computes score correctly with attendance data', async () => {
      mockPrismaService.unit_members.findMany.mockResolvedValue([
        { user_id: 'user-1' },
      ]);
      mockPrismaService.weekly_records.findMany.mockResolvedValue([
        { year: 2026, week: 10, attendance: 80 },
        { year: 2026, week: 11, attendance: 60 },
      ]);
      // 2 active sections out of 2 for this sub-test
      mockPrismaService.club_sections.findMany.mockResolvedValue([
        { club_section_id: 1, active: true, souls_target: 10 },
        { club_section_id: 2, active: true, souls_target: 10 },
      ]);
      mockPrismaService.unit_members.count.mockResolvedValue(5);

      const result = await service.getClubOverview(1);

      // attendance_avg = (80+60)/2 = 70, sections = 100%, capacity = 5/20 = 25%
      // score = 70*0.5 + 100*0.3 + 25*0.2 = 35 + 30 + 5 = 70
      expect(result.data.attendance_average).toBe(70);
      expect(result.data.score.value).toBe(70);
      expect(result.data.score.grade).toBe('B');
    });

    it('score without attendance uses adjusted weights (0.6 sections + 0.4 capacity)', async () => {
      // No members → no weekly records
      mockPrismaService.unit_members.findMany.mockResolvedValue([]);
      mockPrismaService.unit_members.count.mockResolvedValue(10);
      // sections: 1 active / 2 total = 50%
      // capacity: 10 / (20+15) = ~28.57%
      const result = await service.getClubOverview(1);

      expect(result.data.attendance).toBeNull();
      expect(result.data.score.breakdown).toHaveLength(2);
      // score = 50*0.6 + 28.57*0.4 ≈ 30 + 11.43 ≈ 41.4
      expect(result.data.score.value).toBeGreaterThan(40);
      expect(result.data.score.value).toBeLessThan(50);
    });
  });

  describe('updateRoleAssignment', () => {
    it('rejects an inverted effective date range before Prisma writes', async () => {
      mockPrismaService.club_role_assignments.findUnique.mockResolvedValue({
        assignment_id: 'assignment-1',
        user_id: 'user-1',
        role_id: 'role-1',
        club_section_id: 1,
        active: true,
        status: 'active',
        start_date: new Date('2027-01-01T12:00:00.000Z'),
        end_date: new Date('2027-01-31T12:00:00.000Z'),
      });

      await expect(
        service.updateRoleAssignment('assignment-1', {
          start_date: new Date('2027-02-01T00:00:00.000Z'),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_ROLE_DATE_RANGE_INVALID,
      });

      expect(
        mockPrismaService.club_role_assignments.update,
      ).not.toHaveBeenCalled();
    });

    it('updates to secretary-treasurer while ignoring inverted legacy secretary dates', async () => {
      const date = (value: string) => new Date(value);
      mockPrismaService.club_role_assignments.findUnique.mockResolvedValue({
        assignment_id: 'assignment-1',
        user_id: 'user-1',
        role_id: 'role-1',
        club_section_id: 1,
        active: true,
        status: 'active',
        start_date: new Date('2027-01-01'),
        end_date: null,
      });
      mockPrismaService.role_slot_limits.findUnique.mockResolvedValue({
        max_per_section: 2,
      });
      mockPrismaService.club_role_assignments.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { start_date: date('2027-03-01'), end_date: date('2027-01-01') },
        ]);
      mockPrismaService.roles.findFirst.mockResolvedValue({
        role_id: 'role-2',
      });
      mockPrismaService.roles.findUnique.mockResolvedValue({
        role_name: 'secretary-treasurer',
      });
      mockPrismaService.roles.findMany.mockResolvedValue([
        { role_id: 'role-secretary' },
      ]);
      mockPrismaService.club_role_assignments.update.mockResolvedValue({
        assignment_id: 'assignment-1',
        user_id: 'user-1',
        role_id: 'role-2',
        status: 'active',
      });

      const result = await service.updateRoleAssignment('assignment-1', {
        role_id: 'role-2',
        status: 'active',
      });

      expect(result).toEqual(
        expect.objectContaining({
          assignment_id: 'assignment-1',
          role_id: 'role-2',
        }),
      );
      expect(
        mockPrismaService.club_role_assignments.update,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { assignment_id: 'assignment-1' },
          data: expect.objectContaining({
            role_id: 'role-2',
            status: 'active',
          }),
        }),
      );
      expect(mockAuthorizationContextVersionService.bump).toHaveBeenCalledWith(
        mockPrismaService,
        'user-1',
      );
    });

    it('rejects updating an assignment into a second active director in the same section even when role_slot_limits is not seeded', async () => {
      mockPrismaService.club_role_assignments.findUnique.mockResolvedValue({
        assignment_id: 'assignment-1',
        user_id: 'user-1',
        role_id: 'role-member',
        club_section_id: 7,
        active: true,
        status: 'active',
        start_date: new Date('2027-01-01'),
        end_date: null,
        ecclesiastical_year_id: 2026,
      });
      mockEcclesiasticalYearService.getCurrentYear.mockResolvedValue({
        year_id: 2026,
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        active: true,
      });
      mockPrismaService.role_slot_limits.findUnique.mockResolvedValue(null);
      mockPrismaService.roles.findFirst.mockResolvedValue({
        role_id: 'role-director',
      });
      mockPrismaService.roles.findUnique.mockResolvedValue({
        role_name: 'director',
      });
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        { start_date: new Date('2027-01-01'), end_date: null },
      ]);

      await expect(
        service.updateRoleAssignment('assignment-1', {
          role_id: 'role-director',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_ROLE_SLOT_LIMIT_REACHED,
      });

      expect(
        mockPrismaService.club_role_assignments.update,
      ).not.toHaveBeenCalled();
      expect(
        mockPrismaService.club_role_assignments.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            club_section_id: 7,
            role_id: 'role-director',
            active: true,
            assignment_id: { not: 'assignment-1' },
          }),
        }),
      );
    });
  });

  describe('club role assignment authorization versions', () => {
    it('bumps the durable version in the assignment transaction before cleanup', async () => {
      mockPrismaService.role_slot_limits.findUnique.mockResolvedValue({
        max_per_section: 3,
      });
      mockPrismaService.club_role_assignments.count.mockResolvedValue(0);
      mockPrismaService.roles.findFirst.mockResolvedValue({
        role_id: 'role-1',
      });
      mockPrismaService.roles.findUnique.mockResolvedValue({
        role_name: 'member',
      });
      mockPrismaService.roles.findMany.mockResolvedValue([]);
      mockPrismaService.club_role_assignments.create.mockResolvedValue({
        assignment_id: 'assignment-1',
        users: { name: 'Ada', paternal_last_name: 'Lovelace' },
        roles: { role_name: 'member' },
      });

      await service.assignRole({
        user_id: 'user-1',
        role_id: 'role-1',
        club_section_id: 7,
        ecclesiastical_year_id: 2026,
      });

      expect(mockAuthorizationContextVersionService.bump).toHaveBeenCalledWith(
        mockPrismaService,
        'user-1',
      );
      expect(
        mockAuthorizationContextService.invalidateUserAuthorizationCache,
      ).toHaveBeenCalledWith('user-1');
    });

    it('rejects assignRole when role_id is not an active CLUB role', async () => {
      mockPrismaService.roles.findFirst.mockResolvedValue(null);

      await expect(
        service.assignRole({
          user_id: 'user-1',
          role_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          club_section_id: 7,
          ecclesiastical_year_id: 2026,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_ROLE_NOT_FOUND,
      });
      expect(mockPrismaService.roles.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            role_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            role_category: 'CLUB',
            active: true,
          }),
        }),
      );
      expect(
        mockPrismaService.club_role_assignments.create,
      ).not.toHaveBeenCalled();
    });

    it('rejects updateRoleAssignment when role_id is not an active CLUB role', async () => {
      mockPrismaService.club_role_assignments.findUnique.mockResolvedValue({
        assignment_id: 'assignment-1',
        user_id: 'user-1',
        role_id: 'role-member',
        club_section_id: 7,
        active: true,
        status: 'active',
        start_date: new Date('2027-01-01'),
        end_date: null,
      });
      mockPrismaService.roles.findFirst.mockResolvedValue(null);

      await expect(
        service.updateRoleAssignment('assignment-1', {
          role_id: 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_ROLE_NOT_FOUND,
      });
      expect(
        mockPrismaService.club_role_assignments.update,
      ).not.toHaveBeenCalled();
    });

    it('bumps the durable version when a role assignment is removed', async () => {
      mockPrismaService.club_role_assignments.update.mockResolvedValue({
        assignment_id: 'assignment-1',
        user_id: 'user-1',
        club_section_id: 7,
      });

      await service.removeRoleAssignment('assignment-1');

      expect(mockAuthorizationContextVersionService.bump).toHaveBeenCalledWith(
        mockPrismaService,
        'user-1',
      );
      expect(
        mockAuthorizationContextService.invalidateUserAuthorizationCache,
      ).toHaveBeenCalledWith('user-1');
    });
  });

  describe('assignInitialSectionDirector', () => {
    const actorUserId = '00000000-0000-0000-0000-000000000001';
    const directorUserId = '00000000-0000-0000-0000-000000000002';
    const assignmentId = '00000000-0000-0000-0000-000000000003';
    const directorRoleId = '00000000-0000-0000-0000-000000000004';

    beforeEach(() => {
      mockEcclesiasticalYearService.getCurrentYear.mockResolvedValue({
        year_id: 2026,
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        active: true,
      });
    });

    function mockInitialAssignmentTransaction(existingDirectorCount = 0) {
      const tx = {
        club_role_assignments: {
          count: jest.fn().mockResolvedValue(existingDirectorCount),
          create: jest.fn().mockResolvedValue({
            assignment_id: assignmentId,
            user_id: directorUserId,
            club_section_id: 7,
          }),
        },
      };

      mockPrismaService.$transaction = jest.fn((callback) => callback(tx));
      return tx;
    }

    it('creates the initial director when the section has no active director', async () => {
      mockAuthorizationContextService.hasAnyGlobalRole.mockResolvedValue(true);
      mockAuthorizationContextService.canManageClub.mockResolvedValue(true);
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        main_club_id: 99,
      });
      mockPrismaService.roles.findFirst.mockResolvedValue({
        role_id: directorRoleId,
      });
      const tx = mockInitialAssignmentTransaction(0);

      const result = await service.assignInitialSectionDirector(
        7,
        actorUserId,
        {
          user_id: directorUserId,
          ecclesiastical_year_id: 2026,
          start_date: new Date('2026-01-15T00:00:00.000Z'),
        },
      );

      expect(result).toEqual({ assignment_id: assignmentId });
      expect(tx.club_role_assignments.count).toHaveBeenCalledWith({
        where: {
          club_section_id: 7,
          role_id: directorRoleId,
          active: true,
          status: 'active',
          ecclesiastical_year_id: 2026,
        },
      });
      expect(tx.club_role_assignments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: directorUserId,
            role_id: directorRoleId,
            club_section_id: 7,
            ecclesiastical_year_id: 2026,
            active: true,
            status: 'active',
          }),
        }),
      );
      expect(
        mockAuthorizationContextService.invalidateUserAuthorizationCache,
      ).toHaveBeenCalledWith(directorUserId);
      expect(mockAuthorizationContextVersionService.bump).toHaveBeenCalledWith(
        tx,
        directorUserId,
      );
      expect(
        mockAuthorizationContextService.hasAnyGlobalRole,
      ).toHaveBeenCalledWith(actorUserId, [
        'super-admin',
        'admin',
        'director-lf',
        'assistant-lf',
      ]);
    });

    it('rejects initial assignment when the section already has an active director', async () => {
      mockAuthorizationContextService.hasAnyGlobalRole.mockResolvedValue(true);
      mockAuthorizationContextService.canManageClub.mockResolvedValue(true);
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        main_club_id: 99,
      });
      mockPrismaService.roles.findFirst.mockResolvedValue({
        role_id: directorRoleId,
      });
      const tx = mockInitialAssignmentTransaction(1);

      await expect(
        service.assignInitialSectionDirector(7, actorUserId, {
          user_id: directorUserId,
          ecclesiastical_year_id: 2026,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_ROLE_SLOT_LIMIT_REACHED,
      });

      expect(tx.club_role_assignments.create).not.toHaveBeenCalled();
    });

    it('rejects initial assignment when the requested year is not the current year', async () => {
      mockAuthorizationContextService.hasAnyGlobalRole.mockResolvedValue(true);
      mockAuthorizationContextService.canManageClub.mockResolvedValue(true);
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        main_club_id: 99,
      });
      mockPrismaService.roles.findFirst.mockResolvedValue({
        role_id: directorRoleId,
      });
      const tx = mockInitialAssignmentTransaction(0);

      await expect(
        service.assignInitialSectionDirector(7, actorUserId, {
          user_id: directorUserId,
          ecclesiastical_year_id: 2027,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_DIRECTOR_DESIGNATION_YEAR_INVALID,
      });

      expect(tx.club_role_assignments.create).not.toHaveBeenCalled();
    });
  });

  describe('succeedSectionDirector', () => {
    const actorUserId = '00000000-0000-0000-0000-000000000001';
    const oldDirectorUserId = '00000000-0000-0000-0000-000000000002';
    const successorUserId = '00000000-0000-0000-0000-000000000003';
    const currentAssignmentId = '00000000-0000-0000-0000-000000000004';
    const newAssignmentId = '00000000-0000-0000-0000-000000000005';
    const directorRoleId = '00000000-0000-0000-0000-000000000006';

    beforeEach(() => {
      mockEcclesiasticalYearService.getCurrentYear.mockResolvedValue({
        year_id: 2026,
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        active: true,
      });
    });

    function mockSuccessionTransaction(
      overrideCurrentYearId = 2026,
    ) {
      const tx = {
        club_role_assignments: {
          findUnique: jest.fn().mockResolvedValue({
            assignment_id: currentAssignmentId,
            user_id: oldDirectorUserId,
            club_section_id: 7,
            role_id: directorRoleId,
            active: true,
            status: 'active',
            ecclesiastical_year_id: overrideCurrentYearId,
            roles: { role_name: 'director' },
          }),
          count: jest.fn().mockResolvedValue(0),
          update: jest.fn().mockResolvedValue({
            assignment_id: currentAssignmentId,
            user_id: oldDirectorUserId,
            club_section_id: 7,
          }),
          create: jest.fn().mockResolvedValue({
            assignment_id: newAssignmentId,
            user_id: successorUserId,
            club_section_id: 7,
          }),
        },
      };

      mockPrismaService.$transaction = jest.fn((callback) => callback(tx));
      return tx;
    }

    it('closes the current director and creates the successor in one transaction', async () => {
      mockAuthorizationContextService.hasAnyGlobalRole.mockResolvedValue(true);
      mockAuthorizationContextService.canManageClub.mockResolvedValue(true);
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        main_club_id: 99,
      });
      mockPrismaService.roles.findFirst.mockResolvedValue({
        role_id: directorRoleId,
      });
      const tx = mockSuccessionTransaction();

      const result = await service.succeedSectionDirector(7, actorUserId, {
        current_assignment_id: currentAssignmentId,
        successor_user_id: successorUserId,
        ecclesiastical_year_id: 2026,
        start_date: new Date('2026-10-01T00:00:00.000Z'),
      });

      expect(result).toEqual({
        ended_assignment_id: currentAssignmentId,
        new_assignment_id: newAssignmentId,
      });
      expect(tx.club_role_assignments.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { assignment_id: currentAssignmentId },
          data: expect.objectContaining({
            active: false,
            status: 'ended',
            end_date: new Date('2026-10-01T00:00:00.000Z'),
          }),
        }),
      );
      expect(tx.club_role_assignments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: successorUserId,
            role_id: directorRoleId,
            club_section_id: 7,
            ecclesiastical_year_id: 2026,
            active: true,
            status: 'active',
          }),
        }),
      );
      expect(
        mockAuthorizationContextService.invalidateUserAuthorizationCache,
      ).toHaveBeenCalledWith(oldDirectorUserId);
      expect(
        mockAuthorizationContextService.invalidateUserAuthorizationCache,
      ).toHaveBeenCalledWith(successorUserId);
      expect(
        mockAuthorizationContextVersionService.bumpOrdered,
      ).toHaveBeenCalledWith(tx, [oldDirectorUserId, successorUserId]);
      expect(
        mockAuthorizationContextService.hasAnyGlobalRole,
      ).toHaveBeenCalledWith(actorUserId, [
        'super-admin',
        'admin',
        'director-lf',
        'assistant-lf',
      ]);
    });

    it('rejects actors without director succession roles before mutating data', async () => {
      mockAuthorizationContextService.hasAnyGlobalRole.mockResolvedValue(false);

      await expect(
        service.succeedSectionDirector(7, actorUserId, {
          current_assignment_id: currentAssignmentId,
          successor_user_id: successorUserId,
          ecclesiastical_year_id: 2026,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.GUARD_PERMISSION_DENIED,
      });

      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it('rejects succession when dto.ecclesiastical_year_id differs from current assignment year', async () => {
      mockAuthorizationContextService.hasAnyGlobalRole.mockResolvedValue(true);
      mockAuthorizationContextService.canManageClub.mockResolvedValue(true);
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        main_club_id: 99,
      });
      mockPrismaService.roles.findFirst.mockResolvedValue({
        role_id: directorRoleId,
      });
      // current assignment is in year 2026; dto requests year 2027
      mockSuccessionTransaction(2026);

      await expect(
        service.succeedSectionDirector(7, actorUserId, {
          current_assignment_id: currentAssignmentId,
          successor_user_id: successorUserId,
          ecclesiastical_year_id: 2027,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_DIRECTOR_DESIGNATION_YEAR_INVALID,
      });
    });

    it('rejects succession when the assignment year is not the current ecclesiastical year', async () => {
      mockAuthorizationContextService.hasAnyGlobalRole.mockResolvedValue(true);
      mockAuthorizationContextService.canManageClub.mockResolvedValue(true);
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        main_club_id: 99,
      });
      mockPrismaService.roles.findFirst.mockResolvedValue({
        role_id: directorRoleId,
      });
      mockEcclesiasticalYearService.getCurrentYear.mockResolvedValue({
        year_id: 2027,
        start_date: new Date('2027-01-01'),
        end_date: new Date('2027-12-31'),
        active: true,
      });
      const tx = mockSuccessionTransaction(2026);

      await expect(
        service.succeedSectionDirector(7, actorUserId, {
          current_assignment_id: currentAssignmentId,
          successor_user_id: successorUserId,
          ecclesiastical_year_id: 2026,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_DIRECTOR_DESIGNATION_YEAR_INVALID,
      });

      expect(tx.club_role_assignments.update).not.toHaveBeenCalled();
    });
  });

  describe('director year-slot invariants', () => {
    const actorUserId = '00000000-0000-0000-0000-000000000001';
    const directorUserId = '00000000-0000-0000-0000-000000000002';
    const directorRoleId = '00000000-0000-0000-0000-000000000006';

    beforeEach(() => {
      jest.clearAllMocks();
      mockAuthorizationContextService.hasAnyGlobalRole.mockResolvedValue(true);
      mockAuthorizationContextService.canManageClub.mockResolvedValue(true);
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        main_club_id: 99,
      });
      mockPrismaService.roles.findFirst.mockResolvedValue({
        role_id: directorRoleId,
      });
      // director role has max_per_section = 1
      mockPrismaService.roles.findUnique.mockResolvedValue({
        role_name: 'director',
      });
      mockPrismaService.role_slot_limits.findUnique.mockResolvedValue({
        max_per_section: 1,
      });
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
        start_date: new Date('2026-01-01'),
      });
      mockEcclesiasticalYearService.getCurrentYear.mockResolvedValue({
        year_id: 2026,
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        active: true,
      });
    });

    it('allows two active directors in the same section when they are in different ecclesiastical years', async () => {
      // Existing director is in year 2025; new assignment is for year 2026
      // The slot check filtered to year 2026 should return 0 conflicts
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([]);
      mockPrismaService.club_role_assignments.create.mockResolvedValue({
        assignment_id: 'new-id',
        user_id: directorUserId,
        club_section_id: 7,
        roles: { role_name: 'director' },
        users: { name: 'Test', paternal_last_name: 'User' },
      });

      // Should NOT throw CLUB_ROLE_SLOT_LIMIT_REACHED
      // findMany returns [] meaning no active director for year 2026
      await expect(
        service.assignRole({
          club_section_id: 7,
          role: 'director',
          user_id: directorUserId,
          ecclesiastical_year_id: 2026,
          start_date: new Date('2026-01-15'),
        }),
      ).resolves.toBeDefined();

      // The where clause MUST filter by year so prior-year directors are excluded
      expect(
        mockPrismaService.club_role_assignments.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ecclesiastical_year_id: 2026,
            status: 'active',
          }),
        }),
      );
    });

    it('rejects a second active director in the same section and same ecclesiastical year', async () => {
      // Slot check: findMany returns one active director for the same year 2026
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        {
          start_date: new Date('2026-01-01'),
          end_date: null,
        },
      ]);

      await expect(
        service.assignRole({
          club_section_id: 7,
          role: 'director',
          user_id: directorUserId,
          ecclesiastical_year_id: 2026,
          start_date: new Date('2026-06-01'),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_ROLE_SLOT_LIMIT_REACHED,
      });

      // The where clause MUST scope to the same year so cross-year directors are not blocked
      expect(
        mockPrismaService.club_role_assignments.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ecclesiastical_year_id: 2026,
          }),
        }),
      );
    });

    it('does not count a designated director as an operational active slot', async () => {
      // validateRoleSlot early-returns when status !== 'active';
      // This test verifies that assignRole with status=active is accepted even
      // when there is an existing designated row for the same section/year.
      // The designated row is NOT counted because the slot query filters status='active'.
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([]);
      mockPrismaService.club_role_assignments.create.mockResolvedValue({
        assignment_id: 'new-active-id',
        user_id: directorUserId,
        club_section_id: 7,
        roles: { role_name: 'director' },
        users: { name: 'Test', paternal_last_name: 'User' },
      });

      // validateRoleSlot filters status='active', so the existing designated row
      // is excluded from the slot count (findMany returns []).
      await expect(
        service.assignRole({
          club_section_id: 7,
          role: 'director',
          user_id: directorUserId,
          ecclesiastical_year_id: 2026,
          start_date: new Date('2026-06-01'),
          status: 'active',
        }),
      ).resolves.toBeDefined();

      // The where clause MUST include status:'active' so designated rows are not counted
      // AND ecclesiastical_year_id so cross-year rows are also excluded.
      expect(
        mockPrismaService.club_role_assignments.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'active',
            ecclesiastical_year_id: 2026,
          }),
        }),
      );
    });

    it('assignInitialSectionDirector scopes slot count to the dto year and status=active', async () => {
      const assignmentId = '00000000-0000-0000-0000-000000000099';
      mockPrismaService.club_role_assignments.count.mockResolvedValue(0);
      mockPrismaService.club_role_assignments.create.mockResolvedValue({
        assignment_id: assignmentId,
        user_id: directorUserId,
        club_section_id: 7,
      });

      await service.assignInitialSectionDirector(7, actorUserId, {
        user_id: directorUserId,
        ecclesiastical_year_id: 2026,
      });

      expect(mockPrismaService.club_role_assignments.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            club_section_id: 7,
            role_id: directorRoleId,
            active: true,
            status: 'active',
            ecclesiastical_year_id: 2026,
          }),
        }),
      );
    });

    it('rejects PATCH that moves a director assignment to a non-current year', async () => {
      mockPrismaService.club_role_assignments.findUnique.mockResolvedValue({
        assignment_id: 'assignment-y',
        user_id: directorUserId,
        role_id: directorRoleId,
        club_section_id: 7,
        active: true,
        status: 'active',
        start_date: new Date('2026-01-01'),
        end_date: null,
        ecclesiastical_year_id: 2026,
      });
      mockPrismaService.roles.findUnique.mockResolvedValue({
        role_name: 'director',
      });

      await expect(
        service.updateRoleAssignment('assignment-y', {
          ecclesiastical_year_id: 2027,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_DIRECTOR_DESIGNATION_YEAR_INVALID,
      });

      expect(mockPrismaService.club_role_assignments.update).not.toHaveBeenCalled();
    });

    it('rejects updateRoleAssignment that writes status designated', async () => {
      mockPrismaService.club_role_assignments.findUnique.mockResolvedValue({
        assignment_id: 'assignment-y',
        user_id: directorUserId,
        role_id: directorRoleId,
        club_section_id: 7,
        active: true,
        status: 'active',
        start_date: new Date('2026-01-01'),
        end_date: null,
        ecclesiastical_year_id: 2026,
      });
      mockPrismaService.roles.findUnique.mockResolvedValue({
        role_name: 'director',
      });

      await expect(
        service.updateRoleAssignment('assignment-y', {
          status: 'designated',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_DIRECTOR_DESIGNATION_YEAR_INVALID,
      });

      expect(mockPrismaService.club_role_assignments.update).not.toHaveBeenCalled();
    });

    it('rejects activating an unreconciled designated CRA', async () => {
      mockPrismaService.club_role_assignments.findUnique.mockResolvedValue({
        assignment_id: 'assignment-designated',
        user_id: directorUserId,
        role_id: directorRoleId,
        club_section_id: 7,
        active: true,
        status: 'designated',
        start_date: new Date('2027-01-01'),
        end_date: null,
        ecclesiastical_year_id: 2027,
      });

      await expect(
        service.updateRoleAssignment('assignment-designated', {
          status: 'active',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_DIRECTOR_DESIGNATED_UNRECONCILED,
      });

      expect(mockPrismaService.club_role_assignments.update).not.toHaveBeenCalled();
    });

    it('rejects assignRole of director for a non-current year', async () => {
      mockPrismaService.roles.findUnique.mockResolvedValue({
        role_name: 'director',
      });

      await expect(
        service.assignRole({
          club_section_id: 7,
          role: 'director',
          user_id: directorUserId,
          ecclesiastical_year_id: 2027,
          start_date: new Date('2027-01-15'),
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.CLUB_DIRECTOR_DESIGNATION_YEAR_INVALID,
      });

      expect(mockPrismaService.club_role_assignments.create).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // Audit hook tests
  // ========================================

  describe('audit hooks', () => {
    it('create — calls recordEvent with CREATED action', async () => {
      const newClub = { club_id: 5, name: 'Club Nuevo' };
      mockPrismaService.club_types.findMany.mockResolvedValue([
        { club_type_id: 1 },
      ]);
      mockPrismaService.clubs.create.mockResolvedValue(newClub);
      mockPrismaService.club_sections.createMany.mockResolvedValue({ count: 1 });
      mockPrismaService.$transaction.mockImplementation(async (fn: any) =>
        fn(mockPrismaService),
      );

      await service.create({
        name: 'Club Nuevo',
        local_field_id: 1,
        districlub_type_id: 1,
        church_id: 1,
        enabled_club_type_ids: [1],
      });

      // fire-and-forget: give the microtask queue a tick
      await Promise.resolve();

      expect(mockAuditLogsService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'club',
          entity_id: '5',
          action: 'CREATED',
          summary: 'Club creado: Club Nuevo',
        }),
      );
    });

    it('remove — calls recordEvent with DELETED action', async () => {
      const existingClub = {
        club_id: 3,
        name: 'Club a eliminar',
        active: true,
      };
      mockPrismaService.clubs.findUnique.mockResolvedValue(existingClub);
      mockPrismaService.clubs.update.mockResolvedValue({
        ...existingClub,
        active: false,
      });

      await service.remove(3);
      await Promise.resolve();

      expect(mockAuditLogsService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'club',
          entity_id: '3',
          action: 'DELETED',
          summary: 'Club desactivado',
        }),
      );
    });

    it('update — calls recordEvent with UPDATED action and changes diff', async () => {
      const existingClub = {
        club_id: 2,
        name: 'Club Original',
        active: true,
        description: null,
        local_field_id: 1,
        districlub_type_id: 1,
        church_id: 1,
        address: null,
        coordinates: {},
      };
      mockPrismaService.clubs.findUnique.mockResolvedValue(existingClub);
      mockPrismaService.clubs.update.mockResolvedValue({
        ...existingClub,
        name: 'Club Renombrado',
      });

      await service.update(2, { name: 'Club Renombrado' });
      await Promise.resolve();

      expect(mockAuditLogsService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'club',
          action: 'UPDATED',
          changes: expect.objectContaining({
            name: { from: 'Club Original', to: 'Club Renombrado' },
          }),
        }),
      );
    });

    it('update — skips recordEvent when no fields changed', async () => {
      const existingClub = {
        club_id: 2,
        name: 'Same Name',
        active: true,
      };
      mockPrismaService.clubs.findUnique.mockResolvedValue(existingClub);
      mockPrismaService.clubs.update.mockResolvedValue(existingClub);

      await service.update(2, { name: 'Same Name' });
      await Promise.resolve();

      expect(mockAuditLogsService.recordEvent).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // investidos_year real count
  // ========================================

  describe('getClubOverview — investidos_year', () => {
    it('returns real count when active year and members exist', async () => {
      const sections = [{ club_section_id: 1, active: true, souls_target: 20 }];
      mockPrismaService.club_sections.findMany.mockResolvedValue(sections);
      mockPrismaService.activities.findMany.mockResolvedValue([]);
      mockPrismaService.role_assignment_requests.count.mockResolvedValue(0);
      mockPrismaService.unit_members.count.mockResolvedValue(5);
      mockPrismaService.unit_members.findMany.mockResolvedValue([
        { user_id: 'u1' },
        { user_id: 'u2' },
      ]);
      mockPrismaService.weekly_records.findMany.mockResolvedValue([]);
      mockEcclesiasticalYearService.getCurrentYear.mockResolvedValue({
        year_id: 10,
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        active: true,
      });
      mockPrismaService.enrollments.count.mockResolvedValue(3);

      const result = await service.getClubOverview(1);

      expect(result.data.funnel.investidos_year).toBe(3);
      expect(mockPrismaService.enrollments.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ecclesiastical_year_id: 10,
            investiture_status: 'APPROVED',
            active: true,
          }),
        }),
      );
    });

    it('returns 0 when no active ecclesiastical year', async () => {
      mockEcclesiasticalYearService.getCurrentYear.mockRejectedValue(
        new AppNotFoundException(ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND),
      );

      const result = await service.getClubOverview(1);

      expect(result.data.funnel.investidos_year).toBe(0);
    });
  });

  // ========================================
  // getClubHistory
  // ========================================

  describe('getClubHistory', () => {
    it('delegates to AuditLogsService.listByClub with parsed cursor', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue({
        club_id: 1,
        name: 'Club',
      });
      const mockResult = { items: [], next_cursor: null };
      mockAuditLogsService.listByClub.mockResolvedValue(mockResult);

      const result = await service.getClubHistory(1, {
        limit: 10,
        cursor: '50',
      });

      expect(mockAuditLogsService.listByClub).toHaveBeenCalledWith(1, {
        limit: 10,
        cursor: 50n,
      });
      expect(result).toEqual(mockResult);
    });

    it('throws NotFoundException when club does not exist', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue(null);

      await expect(service.getClubHistory(999, {})).rejects.toMatchObject({
        code: ErrorCode.CLUB_NOT_FOUND,
      });
    });
  });

  // -----------------------------------------------------------------------
  // getClubLeadership
  // -----------------------------------------------------------------------
  describe('getClubLeadership', () => {
    const YEAR_ID = 2025;
    const CLUB_ID = 10;

    const activeDirectorRow = {
      assignment_id: 1,
      user_id: 'u1',
      active: true,
      status: 'active',
      ecclesiastical_year_id: YEAR_ID,
      start_date: new Date('2025-01-01'),
      users: {
        user_id: 'u1',
        name: 'John',
        paternal_last_name: 'Doe',
        maternal_last_name: null,
        user_image: null,
        email: 'john@example.com',
      },
      roles: { role_name: 'director', role_category: 'CLUB' },
      club_sections: { club_types: { name: 'Conquistadores' } },
    };

    const designatedDirectorRow = {
      ...activeDirectorRow,
      assignment_id: 2,
      user_id: 'u2',
      status: 'designated',
      users: { ...activeDirectorRow.users, user_id: 'u2', name: 'Jane' },
    };

    beforeEach(() => {
      mockEcclesiasticalYearService.getCurrentYear.mockResolvedValue({
        year_id: YEAR_ID,
        start_date: new Date('2025-01-01'),
        end_date: new Date('2025-12-31'),
        active: true,
      });
    });

    it('passes status="active" and ecclesiastical_year_id in the where clause', async () => {
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([]);

      await service.getClubLeadership(CLUB_ID);

      expect(
        mockPrismaService.club_role_assignments.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            active: true,
            status: 'active',
            ecclesiastical_year_id: YEAR_ID,
            club_sections: { main_club_id: CLUB_ID },
          }),
        }),
      );
    });

    it('returns only the active director, not the designated one', async () => {
      // findMany returns only rows that match the DB filter; in the real DB
      // designated rows are filtered out. We assert the WHERE, then also
      // verify shape with an active-only mock return.
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        activeDirectorRow,
      ]);

      const result = await service.getClubLeadership(CLUB_ID);

      expect(result.data.director).not.toBeNull();
      expect(result.data.director?.user_id).toBe('u1');
      expect(result.data.director?.name).toBe('John');
    });

    it('does NOT include designated-shaped rows (status assertion)', async () => {
      // Simulate a buggy DB returning a designated row (regression guard).
      // The query WHERE ensures this never comes back from the real DB, but
      // the test also confirms that if somehow it did, the where filter would
      // have stopped it. We verify the WHERE explicitly.
      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        designatedDirectorRow,
      ]);

      // Regardless of what findMany returns, the call MUST have the status filter.
      await service.getClubLeadership(CLUB_ID);

      expect(
        mockPrismaService.club_role_assignments.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'active',
          }),
        }),
      );
    });

    it('returns empty leadership when getCurrentYear throws CLASS_ACTIVE_YEAR_NOT_FOUND', async () => {
      mockEcclesiasticalYearService.getCurrentYear.mockRejectedValue(
        new AppNotFoundException(ErrorCode.CLASS_ACTIVE_YEAR_NOT_FOUND),
      );

      const result = await service.getClubLeadership(CLUB_ID);

      expect(result.status).toBe('ok');
      expect(result.data.director).toBeNull();
      expect(result.data.deputies).toEqual([]);
      expect(result.data.secretaries).toEqual([]);
      expect(result.data.others).toEqual([]);
      // findMany must NOT have been called
      expect(
        mockPrismaService.club_role_assignments.findMany,
      ).not.toHaveBeenCalled();
    });

    it('groups deputies and secretaries correctly', async () => {
      const deputyRow = {
        ...activeDirectorRow,
        assignment_id: 3,
        user_id: 'u3',
        roles: { role_name: 'deputy-director', role_category: 'CLUB' },
        users: { ...activeDirectorRow.users, user_id: 'u3', name: 'Deputy' },
      };
      const secretaryRow = {
        ...activeDirectorRow,
        assignment_id: 4,
        user_id: 'u4',
        roles: { role_name: 'secretary', role_category: 'CLUB' },
        users: { ...activeDirectorRow.users, user_id: 'u4', name: 'Secretary' },
      };

      mockPrismaService.club_role_assignments.findMany.mockResolvedValue([
        activeDirectorRow,
        deputyRow,
        secretaryRow,
      ]);

      const result = await service.getClubLeadership(CLUB_ID);

      expect(result.data.director?.user_id).toBe('u1');
      expect(result.data.deputies).toHaveLength(1);
      expect(result.data.deputies[0].user_id).toBe('u3');
      expect(result.data.secretaries).toHaveLength(1);
      expect(result.data.secretaries[0].user_id).toBe('u4');
    });
  });
});
