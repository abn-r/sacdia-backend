import { Test, TestingModule } from '@nestjs/testing';
import { ClubsService } from './clubs.service';
import { PrismaService } from '../prisma/prisma.service';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import { AuthorizationContextService } from '../common/services/authorization-context.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ErrorCode } from '../common/errors/error-codes';

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
    },
    club_sections: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
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
    enrollments: {
      count: jest.fn(),
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
          provide: NotificationsService,
          useValue: {
            sendSilentToSection: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AuditLogsService,
          useValue: mockAuditLogsService,
        },
      ],
    }).compile();

    service = module.get<ClubsService>(ClubsService);
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
    it('should create a new club', async () => {
      const createDto = {
        name: 'Nuevo Club',
        local_field_id: 1,
        districlub_type_id: 1,
        church_id: 1,
      };

      const mockCreatedClub = { club_id: 1, ...createDto };
      mockPrismaService.clubs.create.mockResolvedValue(mockCreatedClub);

      const result = await service.create(createDto);

      expect(result).toEqual(mockCreatedClub);
      expect(mockPrismaService.clubs.create).toHaveBeenCalled();
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
    it('persists the optional section name when creating a club section', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue({
        club_id: 10,
        name: 'Club Norte',
      });
      mockPrismaService.club_types.findUnique.mockResolvedValue({
        club_type_id: 1,
        name: 'Aventureros',
        active: true,
      });
      mockPrismaService.club_sections.create.mockResolvedValue({
        club_section_id: 7,
        main_club_id: 10,
        club_type_id: 1,
        name: 'Aventureros Central',
        club_types: { name: 'Aventureros' },
      });

      await service.createSection(10, {
        club_type_id: 1,
        name: 'Aventureros Central',
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
            name: 'Aventureros Central',
            souls_target: 0,
            fee: 0,
          }),
        }),
      );
    });
  });

  describe('getMembers', () => {
    it('includes the active yearly class for the requested section type', async () => {
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        club_type_id: 2,
      });
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 2026,
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

      const result = await service.getMembers(7);

      expect(
        mockPrismaService.club_role_assignments.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
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
        users: {
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
      club_sections: sectionName ? { name: sectionName } : null,
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
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(null);
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
          club_sections: { name: 'Conquistadores' },
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
    it('should update role_id on an existing assignment without recreating it', async () => {
      mockPrismaService.club_role_assignments.findUnique.mockResolvedValue({
        assignment_id: 'assignment-1',
        user_id: 'user-1',
        role_id: 'role-1',
        club_section_id: 1,
        active: true,
      });
      mockPrismaService.role_slot_limits.findUnique.mockResolvedValue({
        max_per_section: 2,
      });
      mockPrismaService.club_role_assignments.count.mockResolvedValue(0);
      mockPrismaService.roles.findUnique.mockResolvedValue({
        role_name: 'deputy-director',
      });
      mockPrismaService.roles.findMany.mockResolvedValue([]);
      mockPrismaService.club_role_assignments.update.mockResolvedValue({
        assignment_id: 'assignment-1',
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
    });

    it('rejects updating an assignment into a second active director in the same section even when role_slot_limits is not seeded', async () => {
      mockPrismaService.club_role_assignments.findUnique.mockResolvedValue({
        assignment_id: 'assignment-1',
        user_id: 'user-1',
        role_id: 'role-member',
        club_section_id: 7,
        active: true,
      });
      mockPrismaService.role_slot_limits.findUnique.mockResolvedValue(null);
      mockPrismaService.roles.findUnique.mockResolvedValue({
        role_name: 'director',
      });
      mockPrismaService.club_role_assignments.count.mockResolvedValue(1);

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
        mockPrismaService.club_role_assignments.count,
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

  describe('succeedSectionDirector', () => {
    const actorUserId = '00000000-0000-0000-0000-000000000001';
    const oldDirectorUserId = '00000000-0000-0000-0000-000000000002';
    const successorUserId = '00000000-0000-0000-0000-000000000003';
    const currentAssignmentId = '00000000-0000-0000-0000-000000000004';
    const newAssignmentId = '00000000-0000-0000-0000-000000000005';
    const directorRoleId = '00000000-0000-0000-0000-000000000006';

    function mockSuccessionTransaction() {
      const tx = {
        club_role_assignments: {
          findUnique: jest.fn().mockResolvedValue({
            assignment_id: currentAssignmentId,
            user_id: oldDirectorUserId,
            club_section_id: 7,
            role_id: directorRoleId,
            active: true,
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
    });

    it('rejects actors that are not director-lf or assistant-lf before mutating data', async () => {
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
  });

  // ========================================
  // Audit hook tests
  // ========================================

  describe('audit hooks', () => {
    it('create — calls recordEvent with CREATED action', async () => {
      const newClub = { club_id: 5, name: 'Club Nuevo' };
      mockPrismaService.clubs.create.mockResolvedValue(newClub);

      await service.create({
        name: 'Club Nuevo',
        local_field_id: 1,
        districlub_type_id: 1,
        church_id: 1,
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
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 10,
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
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(null);

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
});
