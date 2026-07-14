import { Test, TestingModule } from '@nestjs/testing';
import { CamporeesService } from './camporees.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AchievementsService } from '../achievements/achievements.service';
import { ErrorCode } from '../common/errors/error-codes';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import { CamporeeMembersListQueryDto } from './dto/camporee-members-list-query.dto';
import { CamporeeLifecyclePolicy } from './policies';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateCamporeeDto,
  CreateUnionCamporeeDto,
  UpdateCamporeeDto,
  UpdateUnionCamporeeDto,
} from './dto';
import type { AuthorizationSnapshot } from '../common/services/authorization-context.service';

describe('CamporeesService', () => {
  let service: CamporeesService;
  let _prisma: PrismaService;

  const mockLifecyclePolicy = {
    assertDateOrder: jest.fn(),
    assertDateOnly: jest.fn(),
    assertOffsetTimestamp: jest.fn(),
    assertIanaTimezone: jest.fn((value: unknown) => {
      if (typeof value !== 'string')
        throw new Error('Expected an IANA timezone');
    }),
    resolveClubRegistrationDisposition: jest.fn(() => 'open'),
    isAfterDeadline: jest.fn((deadline: Date | null | undefined) =>
      deadline ? new Date() > deadline : false,
    ),
  };

  const mockPrismaService = {
    local_camporees: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    union_camporees: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    camporee_members: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    camporee_payments: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    camporee_clubs: {
      count: jest.fn(),
      findFirst: jest.fn(),
    },
    club_sections: {
      findUnique: jest.fn(),
    },
    camporee_event_section_results: {
      count: jest.fn(),
    },
    camporee_event_judge_assignments: {
      count: jest.fn(),
    },
    member_insurances: {
      findUnique: jest.fn(),
    },
    users: {
      findUnique: jest.fn(),
    },
    local_fields: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    unions: { findUnique: jest.fn() },
    union_camporee_local_fields: {
      createMany: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
      findFirst: jest.fn(),
    },
    ecclesiastical_years: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockFileStorageService = {
    getSignedDownloadUrl: jest.fn(
      async (_bucket: unknown, value: string) => value,
    ),
    upload: jest.fn(),
    deleteMany: jest.fn(),
    extractKeyFromPublicUrl: jest.fn((_bucket: unknown, url: string) => url),
  };

  const mockNotificationsService = {
    sendToGlobalRole: jest.fn(),
  };

  const mockAchievementsService = {
    emitEvent: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    // Restore default $transaction implementation before each test.
    // Tests that need the callback form override it via mockImplementation within the test.
    // clearAllMocks() does NOT reset implementations, so we must re-apply here.
    mockPrismaService.$transaction.mockImplementation((arg: unknown) => {
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      // callback form — should be overridden per-test for registerMember/enrollClub etc.
      return Promise.resolve(arg);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CamporeesService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: FILE_STORAGE_SERVICE,
          useValue: mockFileStorageService,
        },
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
        {
          provide: AchievementsService,
          useValue: mockAchievementsService,
        },
        {
          provide: CamporeeLifecyclePolicy,
          useValue: mockLifecyclePolicy,
        },
      ],
    }).compile();

    service = module.get<CamporeesService>(CamporeesService);
    _prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('timezone DTO validation', () => {
    it.each([
      CreateCamporeeDto,
      UpdateCamporeeDto,
      CreateUnionCamporeeDto,
      UpdateUnionCamporeeDto,
    ])('rejects null timezone in %p', async (Dto) => {
      const errors = await validate(plainToInstance(Dto, { timezone: null }));
      expect(errors.some((error) => error.property === 'timezone')).toBe(true);
    });
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('active section registration', () => {
    const camporeeId = 7;
    const actorId = 'request-actor';
    const registeredAt = new Date('2026-07-01T12:00:00.000Z');

    const authorization = (
      overrides: {
        activeAssignmentId?: string | null;
        grantAssignmentId?: string;
        roleName?: string;
        localFieldId?: number;
      } = {},
    ): AuthorizationSnapshot => ({
      grants: {
        global_roles: [],
        club_assignments: [
          {
            assignment_id: overrides.grantAssignmentId ?? 'assignment-1',
            role_name: overrides.roleName ?? 'director',
            permissions: ['camporees:read'],
            club: { club_id: 12, club_name: 'Orión' },
            section: {
              club_section_id: 44,
              club_type_id: 2,
              club_type_name: 'Conquistadores',
            },
            scope: {
              local_field: {
                id: overrides.localFieldId ?? 5,
                name: 'Campo Norte',
              },
            },
            status: 'active',
          },
        ],
      },
      active_assignment: {
        assignment_id:
          overrides.activeAssignmentId === undefined
            ? 'assignment-1'
            : overrides.activeAssignmentId,
      },
      effective: {
        permissions: ['camporees:read'],
        scope: {
          global: {},
          club: null,
        },
      },
    });

    const camporee = (overrides: Record<string, unknown> = {}) => ({
      local_camporee_id: camporeeId,
      local_field_id: 5,
      active: true,
      includes_adventurers: false,
      includes_pathfinders: true,
      includes_master_guides: false,
      start_date: new Date('2026-08-01T00:00:00.000Z'),
      end_date: new Date('2026-08-03T00:00:00.000Z'),
      club_registration_opens_at: new Date('2026-06-01T00:00:00.000Z'),
      club_registration_deadline: new Date('2026-07-20T00:00:00.000Z'),
      club_registration_closed_at: null,
      member_registration_deadline: null,
      payment_deadline: null,
      timezone: 'America/Mexico_City',
      timezone_verified_at: registeredAt,
      ...overrides,
    });

    const section = (overrides: Record<string, unknown> = {}) => ({
      club_section_id: 44,
      name: 'Conquistadores Orión',
      active: true,
      club_type_id: 2,
      club_types: {
        club_type_id: 2,
        name: 'Conquistadores',
        active: true,
      },
      ...overrides,
    });

    beforeEach(() => {
      mockPrismaService.local_camporees.findFirst.mockResolvedValue(camporee());
      mockPrismaService.club_sections.findUnique.mockResolvedValue(section());
      mockPrismaService.camporee_clubs.findFirst.mockResolvedValue(null);
      mockLifecyclePolicy.resolveClubRegistrationDisposition.mockReturnValue(
        'open',
      );
    });

    it('returns the active director section as not enrolled and enrollable', async () => {
      await expect(
        service.getActiveSectionRegistration(
          camporeeId,
          actorId,
          authorization(),
        ),
      ).resolves.toEqual({
        camporeeId,
        clubId: 12,
        clubName: 'Orión',
        clubSectionId: 44,
        sectionName: 'Conquistadores Orión',
        clubTypeId: 2,
        clubTypeName: 'Conquistadores',
        status: 'not_enrolled',
        disposition: 'open',
        canEnroll: true,
        blockingReason: null,
        enrollmentId: null,
        registeredAt: null,
        registeredBy: null,
      });

      expect(mockPrismaService.local_camporees.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { local_camporee_id: camporeeId, local_field_id: 5 },
        }),
      );
      expect(mockPrismaService.camporee_clubs.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            camporee_id: camporeeId,
            club_section_id: 44,
            active: true,
          },
        }),
      );
    });

    it('maps an existing active enrollment and its registrar instead of the request actor', async () => {
      mockPrismaService.camporee_clubs.findFirst.mockResolvedValue({
        camporee_club_id: 91,
        status: 'approved',
        created_at: registeredAt,
        registrar: {
          user_id: 'registrar-1',
          name: 'Ana',
          paternal_last_name: 'Pérez',
          maternal_last_name: 'López',
        },
      });

      const result = await service.getActiveSectionRegistration(
        camporeeId,
        actorId,
        authorization(),
      );

      expect(result).toMatchObject({
        status: 'approved',
        canEnroll: false,
        blockingReason: 'already_enrolled',
        enrollmentId: 91,
        registeredAt,
        registeredBy: {
          userId: 'registrar-1',
          displayName: 'Ana Pérez López',
        },
      });
      expect(result.registeredBy?.userId).not.toBe(actorId);
    });

    it('allows a non-director active grant to read but not enroll', async () => {
      const result = await service.getActiveSectionRegistration(
        camporeeId,
        actorId,
        authorization({ roleName: 'secretary' }),
      );

      expect(result).toMatchObject({
        status: 'not_enrolled',
        canEnroll: false,
        blockingReason: 'director_role_required',
      });
    });

    it('blocks enrollment when the active club type is excluded from the camporee', async () => {
      mockPrismaService.local_camporees.findFirst.mockResolvedValue(
        camporee({ includes_pathfinders: false }),
      );

      const result = await service.getActiveSectionRegistration(
        camporeeId,
        actorId,
        authorization(),
      );

      expect(result).toMatchObject({
        status: 'not_enrolled',
        canEnroll: false,
        blockingReason: 'club_type_not_included',
      });
    });

    it.each([
      [
        'missing active assignment',
        authorization({ activeAssignmentId: null }),
      ],
      [
        'active assignment without a matching grant',
        authorization({ activeAssignmentId: 'assignment-missing' }),
      ],
    ])('rejects %s with a typed forbidden error', async (_label, snapshot) => {
      await expect(
        service.getActiveSectionRegistration(camporeeId, actorId, snapshot),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_ACTIVE_SECTION_REQUIRED,
      });

      expect(
        mockPrismaService.local_camporees.findFirst,
      ).not.toHaveBeenCalled();
    });

    it('preserves territorial visibility from the active authorization snapshot', async () => {
      mockPrismaService.local_camporees.findFirst.mockResolvedValue(null);

      await expect(
        service.getActiveSectionRegistration(
          camporeeId,
          actorId,
          authorization({ localFieldId: 99 }),
        ),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_NOT_FOUND });

      expect(mockPrismaService.local_camporees.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { local_camporee_id: camporeeId, local_field_id: 99 },
        }),
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated local camporees', async () => {
      const mockCamporees = [
        {
          local_camporee_id: 1,
          name: 'Camporee Test',
          description: 'Test description',
          start_date: new Date('2026-06-01'),
          end_date: new Date('2026-06-03'),
          active: true,
          local_fields: {
            local_field_id: 1,
            name: 'Test Field',
            abbreviation: 'TF',
          },
          ecclesiastical_year_relation: {
            year_id: 1,
            start_date: new Date('2026-01-01'),
            end_date: new Date('2026-12-31'),
          },
        },
      ];

      mockPrismaService.local_camporees.findMany.mockResolvedValue(
        mockCamporees,
      );
      mockPrismaService.local_camporees.count.mockResolvedValue(1);

      const result = await service.findAll({}, {
        page: 1,
        limit: 20,
      } as unknown as import('../common/dto/pagination.dto').PaginationDto);

      expect(result.data).toEqual(mockCamporees);
      expect(result.meta.total).toBe(1);
      expect(mockPrismaService.local_camporees.findMany).toHaveBeenCalled();
    });

    it('should filter by active status', async () => {
      mockPrismaService.local_camporees.findMany.mockResolvedValue([]);
      mockPrismaService.local_camporees.count.mockResolvedValue(0);

      await service.findAll({ active: true });

      expect(mockPrismaService.local_camporees.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { active: true },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('should return a local camporee by id', async () => {
      const mockCamporee = {
        local_camporee_id: 1,
        name: 'Camporee Test',
        active: true,
        local_fields: { local_field_id: 1, name: 'Test Field' },
        ecclesiastical_year_relation: { year_id: 1 },
        attending_members_camporees: [],
      };

      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );

      const result = await service.findOne(1);

      expect(result).toEqual(mockCamporee);
      expect(mockPrismaService.local_camporees.findUnique).toHaveBeenCalledWith(
        {
          where: { local_camporee_id: 1 },
          include: expect.any(Object),
        },
      );
    });

    it('should throw NotFoundException if camporee not found', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_NOT_FOUND,
      });
    });
  });

  describe('create', () => {
    it('should create a new local camporee', async () => {
      const createDto = {
        name: 'New Camporee',
        description: 'Description',
        start_date: '2026-06-01',
        end_date: '2026-06-03',
        club_registration_deadline: '2026-05-10T23:59:59.000Z',
        member_registration_deadline: '2026-05-20T23:59:59.000Z',
        payment_deadline: '2026-05-30T23:59:59.000Z',
        local_field_id: 1,
        includes_adventurers: true,
        includes_pathfinders: true,
        includes_master_guides: false,
        local_camporee_place: 'Test Location',
        lat: 19.1738,
        long: -96.1342,
        registration_cost: 50.0,
      };

      const mockEcclesiasticalYear = {
        year_id: 1,
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        active: true,
      };

      const mockLocalField = {
        local_field_id: 1,
        name: 'Test Field',
        abbreviation: 'TF',
      };

      const mockCreated = {
        local_camporee_id: 1,
        ...createDto,
        start_date: new Date(createDto.start_date),
        end_date: new Date(createDto.end_date),
        ecclesiastical_year: 1,
        active: true,
        local_fields: mockLocalField,
        ecclesiastical_year_relation: mockEcclesiasticalYear,
      };

      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(
        mockEcclesiasticalYear,
      );
      mockPrismaService.local_fields.findUnique.mockResolvedValue(
        mockLocalField,
      );
      mockPrismaService.local_camporees.create.mockResolvedValue(mockCreated);

      const result = await service.create(createDto, 'user1');

      expect(result).toEqual(mockCreated);
      expect(
        mockPrismaService.ecclesiastical_years.findFirst,
      ).toHaveBeenCalled();
      expect(mockPrismaService.local_fields.findUnique).toHaveBeenCalledWith({
        where: { local_field_id: 1 },
      });
      expect(mockPrismaService.local_camporees.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: createDto.name,
            lat: createDto.lat,
            long: createDto.long,
            club_registration_deadline: new Date(
              createDto.club_registration_deadline,
            ),
            member_registration_deadline: new Date(
              createDto.member_registration_deadline,
            ),
            payment_deadline: new Date(createDto.payment_deadline),
            active: true,
            ecclesiastical_year: 1,
          }),
        }),
      );
    });

    it('should throw BadRequestException if no active ecclesiastical year', async () => {
      const createDto = {
        name: 'New Camporee',
        description: 'Description',
        start_date: '2026-06-01',
        end_date: '2026-06-03',
        local_field_id: 1,
        includes_adventurers: true,
        includes_pathfinders: true,
        includes_master_guides: false,
        local_camporee_place: 'Test Location',
        registration_cost: 50.0,
      };

      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue(null);

      await expect(service.create(createDto, 'user1')).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_YEAR_NOT_ACTIVE,
      });
    });

    it('should throw BadRequestException if local field not found', async () => {
      const createDto = {
        name: 'New Camporee',
        description: 'Description',
        start_date: '2026-06-01',
        end_date: '2026-06-03',
        local_field_id: 999,
        includes_adventurers: true,
        includes_pathfinders: true,
        includes_master_guides: false,
        local_camporee_place: 'Test Location',
        registration_cost: 50.0,
      };

      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 1,
        active: true,
      });
      mockPrismaService.local_fields.findUnique.mockResolvedValue(null);

      await expect(service.create(createDto, 'user1')).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_LOCAL_FIELD_NOT_FOUND,
      });
    });

    it('records timezone verification and explicit registration opening', async () => {
      const createDto = {
        name: 'Timezone-aware Camporee',
        start_date: '2026-07-10',
        end_date: '2026-07-12',
        timezone: 'America/Mexico_City',
        club_registration_opens_at: '2026-07-01T15:00:00.000Z',
        club_registration_deadline: '2026-07-09T23:59:59.000Z',
        member_registration_deadline: '2026-07-09T23:59:59.000Z',
        payment_deadline: '2026-07-09T23:59:59.000Z',
        local_field_id: 1,
        includes_adventurers: true,
        includes_pathfinders: true,
        includes_master_guides: false,
        local_camporee_place: 'Test Location',
      };
      mockPrismaService.ecclesiastical_years.findFirst.mockResolvedValue({
        year_id: 1,
      });
      mockPrismaService.local_fields.findUnique.mockResolvedValue({
        local_field_id: 1,
      });
      mockPrismaService.local_camporees.create.mockResolvedValue({
        local_camporee_id: 1,
      });

      await service.create(createDto, 'actor-id');

      expect(mockPrismaService.local_camporees.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            timezone: 'America/Mexico_City',
            timezone_verified_by: 'actor-id',
            timezone_verified_at: expect.any(Date),
            club_registration_opens_at: new Date('2026-07-01T15:00:00.000Z'),
          }),
        }),
      );
    });

    it('rejects a null local timezone instead of verifying the default', async () => {
      await expect(
        service.create(
          {
            name: 'Invalid timezone',
            start_date: '2026-07-10',
            end_date: '2026-07-12',
            timezone: null,
            local_field_id: 1,
            includes_adventurers: true,
            includes_pathfinders: true,
            includes_master_guides: false,
            local_camporee_place: 'Test Location',
          } as any,
          'actor-id',
        ),
      ).rejects.toThrow('Expected an IANA timezone');
    });
  });

  describe('update', () => {
    it('should update a local camporee', async () => {
      const mockCamporee = {
        local_camporee_id: 1,
        name: 'Old Name',
        active: true,
        local_fields: {},
        ecclesiastical_year_relation: {},
        attending_members_camporees: [],
      };

      const updateDto = {
        name: 'Updated Name',
        description: 'Updated Description',
      };

      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );
      mockPrismaService.local_camporees.update.mockResolvedValue({
        ...mockCamporee,
        ...updateDto,
      });

      const result = await service.update(1, updateDto);

      expect(result.name).toBe(updateDto.name);
      expect(mockPrismaService.local_camporees.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException if camporee not found', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue(null);

      await expect(service.update(999, { name: 'Test' })).rejects.toMatchObject(
        { code: ErrorCode.CAMPOREE_NOT_FOUND },
      );
    });

    it('preserves timezone verification on a patch that omits timezone', async () => {
      const verifiedAt = new Date('2026-01-01T00:00:00.000Z');
      mockPrismaService.local_camporees.findUnique.mockResolvedValue({
        local_camporee_id: 1,
        start_date: new Date('2026-07-10T00:00:00.000Z'),
        end_date: new Date('2026-07-12T00:00:00.000Z'),
        timezone: 'America/Mexico_City',
        timezone_verified_at: verifiedAt,
        timezone_verified_by: 'prior-actor',
        club_registration_opens_at: null,
        club_registration_deadline: null,
        member_registration_deadline: null,
        payment_deadline: null,
        local_fields: {},
        ecclesiastical_year_relation: {},
        attending_members_camporees: [],
      });
      mockPrismaService.local_camporees.update.mockResolvedValue({
        local_camporee_id: 1,
        name: 'Updated',
      });

      await service.update(1, { name: 'Updated' }, 'actor-id');

      expect(mockPrismaService.local_camporees.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({
            timezone_verified_at: expect.anything(),
            timezone_verified_by: expect.anything(),
          }),
        }),
      );
    });

    it('rejects a null local timezone instead of rewriting verification metadata', async () => {
      await expect(
        service.update(1, { timezone: null } as any, 'actor-id'),
      ).rejects.toThrow('Expected an IANA timezone');
    });

    it('uses an explicit null opening when validating a local patch', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue({
        local_camporee_id: 1,
        start_date: new Date('2026-07-10T00:00:00.000Z'),
        end_date: new Date('2026-07-12T00:00:00.000Z'),
        timezone: 'America/Mexico_City',
        club_registration_opens_at: new Date('2026-07-10T00:00:00.000Z'),
        club_registration_deadline: new Date('2026-07-09T23:59:59.000Z'),
        local_fields: {},
        ecclesiastical_year_relation: {},
        attending_members_camporees: [],
      });
      mockPrismaService.local_camporees.update.mockResolvedValue({
        local_camporee_id: 1,
      });

      await service.update(1, { club_registration_opens_at: null }, 'actor-id');

      expect(mockLifecyclePolicy.assertDateOrder).toHaveBeenCalledWith(
        expect.objectContaining({ clubRegistrationOpensAt: null }),
      );
      expect(mockPrismaService.local_camporees.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ club_registration_opens_at: null }),
        }),
      );
    });
  });

  describe('union timezone handling', () => {
    it('rejects a null union timezone on create', async () => {
      await expect(
        service.createUnion(
          {
            name: 'Invalid union timezone',
            start_date: '2026-07-10',
            end_date: '2026-07-12',
            timezone: null,
            union_id: 1,
            includes_adventurers: true,
            includes_pathfinders: true,
            includes_master_guides: false,
            union_camporee_place: 'Test Location',
          } as any,
          'actor-id',
        ),
      ).rejects.toThrow('Expected an IANA timezone');
    });

    it('rejects a null union timezone on update', async () => {
      await expect(
        service.updateUnion(1, { timezone: null } as any, 'actor-id'),
      ).rejects.toThrow('Expected an IANA timezone');
    });

    it('preserves union timezone verification when timezone is omitted', async () => {
      mockPrismaService.union_camporees.findUnique
        .mockResolvedValueOnce({
          union_camporee_id: 1,
          start_date: new Date('2026-07-10T00:00:00.000Z'),
          end_date: new Date('2026-07-12T00:00:00.000Z'),
          timezone: 'America/Mexico_City',
          timezone_verified_at: new Date('2026-01-01T00:00:00.000Z'),
          timezone_verified_by: 'prior-actor',
          club_registration_opens_at: null,
          club_registration_deadline: null,
          member_registration_deadline: null,
          payment_deadline: null,
          union_camporee_local_fields: [],
        })
        .mockResolvedValueOnce({ union_camporee_id: 1, name: 'Updated' });
      mockPrismaService.union_camporees.update.mockResolvedValue({
        union_camporee_id: 1,
        union_id: 1,
      });
      mockPrismaService.$transaction.mockImplementation(async (callback: any) =>
        callback(mockPrismaService),
      );

      await service.updateUnion(1, { name: 'Updated' }, 'actor-id');

      expect(mockPrismaService.union_camporees.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({
            timezone_verified_at: expect.anything(),
            timezone_verified_by: expect.anything(),
          }),
        }),
      );
    });
  });

  describe('temporal deadline policy', () => {
    const memberDeadline = new Date('2026-07-09T23:59:59.000Z');
    const paymentDeadline = new Date('2026-07-10T23:59:59.000Z');

    beforeEach(() => {
      mockLifecyclePolicy.isAfterDeadline.mockReturnValue(true);
      mockPrismaService.$transaction.mockImplementation(async (callback: any) =>
        callback(mockPrismaService),
      );
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: 'user-1',
      });
      mockPrismaService.camporee_members.findFirst.mockResolvedValue(null);
      mockPrismaService.camporee_members.create.mockResolvedValue({
        camporee_member_id: 1,
      });
      mockPrismaService.camporee_payments.create.mockResolvedValue({
        camporee_payment_id: 'payment-1',
      });
    });

    it('uses the policy for a local member deadline', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue({
        active: true,
        local_field_id: 1,
        name: 'Local',
        end_date: new Date('2026-07-12'),
        member_registration_deadline: memberDeadline,
      });

      await service.registerMember(1, { user_id: 'user-1', club_name: 'Club' });

      expect(mockLifecyclePolicy.isAfterDeadline).toHaveBeenCalledWith(
        memberDeadline,
      );
    });

    it('uses the policy for a local payment deadline', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue({
        local_field_id: 1,
        payment_deadline: paymentDeadline,
      });
      mockPrismaService.camporee_members.findFirst.mockResolvedValue({
        camporee_member_id: 1,
      });

      await service.createPayment(
        1,
        1,
        { amount: 10, payment_type: 'other', paid_at: '2026-07-01T00:00:00Z' },
        'actor-id',
      );

      expect(mockLifecyclePolicy.isAfterDeadline).toHaveBeenCalledWith(
        paymentDeadline,
      );
    });

    it('uses the policy for a union member deadline', async () => {
      mockPrismaService.union_camporees.findUnique.mockResolvedValue({
        active: true,
        union_id: 1,
        name: 'Union',
        end_date: new Date('2026-07-12'),
        member_registration_deadline: memberDeadline,
      });

      await service.registerMemberToUnion(1, {
        user_id: 'user-1',
        club_name: 'Club',
      });

      expect(mockLifecyclePolicy.isAfterDeadline).toHaveBeenCalledWith(
        memberDeadline,
      );
    });

    it('uses the policy for a union payment deadline', async () => {
      mockPrismaService.union_camporees.findUnique.mockResolvedValue({
        union_id: 1,
        payment_deadline: paymentDeadline,
      });
      mockPrismaService.camporee_members.findFirst.mockResolvedValue({
        camporee_member_id: 1,
      });

      await service.createUnionPayment(
        1,
        1,
        { amount: 10, payment_type: 'other', paid_at: '2026-07-01T00:00:00Z' },
        'actor-id',
      );

      expect(mockLifecyclePolicy.isAfterDeadline).toHaveBeenCalledWith(
        paymentDeadline,
      );
    });
  });

  describe('remove', () => {
    it('should soft delete a local camporee', async () => {
      const mockCamporee = {
        local_camporee_id: 1,
        name: 'Test',
        active: true,
        local_fields: {},
        ecclesiastical_year_relation: {},
        attending_members_camporees: [],
      };

      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );
      mockPrismaService.local_camporees.update.mockResolvedValue({
        ...mockCamporee,
        active: false,
      });

      const result = await service.remove(1);

      expect(result.active).toBe(false);
      expect(mockPrismaService.local_camporees.update).toHaveBeenCalledWith({
        where: { local_camporee_id: 1 },
        data: expect.objectContaining({
          active: false,
        }),
      });
    });
  });

  describe('registerMember', () => {
    it('should register a member with valid insurance', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        club_name: 'Test Club',
        insurance_id: 1,
      };

      const mockCamporee = {
        local_camporee_id: 1,
        name: 'Test Camporee',
        end_date: new Date('2026-06-03'),
        active: true,
      };

      const mockUser = {
        user_id: 'user-uuid',
        name: 'Test User',
      };

      const mockInsurance = {
        insurance_id: 1,
        user_id: 'user-uuid',
        insurance_type: 'CAMPOREE',
        end_date: new Date('2026-12-31'),
        active: true,
      };

      const mockMember = {
        camporee_member_id: 1,
        camporee_id: 1,
        camporee_type: 'local',
        user_id: 'user-uuid',
        club_name: 'Test Club',
        insurance_verified: true,
        insurance_id: 1,
        active: true,
        users: mockUser,
        insurance: mockInsurance,
      };

      let createMemberMock: jest.Mock | undefined;

      // Mock transaction
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        createMemberMock = jest.fn().mockResolvedValue(mockMember);
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue(mockCamporee),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue(mockUser),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: createMemberMock,
          },
          member_insurances: {
            findUnique: jest.fn().mockResolvedValue(mockInsurance),
          },
        };
        return callback(tx);
      });

      const result = await service.registerMember(1, registerDto);

      expect(result).toEqual(mockMember);
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(createMemberMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            camporee_type: 'local',
            user_id: 'user-uuid',
            insurance_id: 1,
          }),
        }),
      );
    });

    it('should register a member with GENERAL_ACTIVITIES insurance', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        club_name: 'Test Club',
        insurance_id: 1,
      };

      const mockInsurance = {
        insurance_id: 1,
        user_id: 'user-uuid',
        insurance_type: 'GENERAL_ACTIVITIES',
        end_date: new Date('2026-12-31'),
        active: true,
      };

      const mockMember = {
        camporee_member_id: 2,
        camporee_id: 1,
        camporee_type: 'local',
        user_id: 'user-uuid',
        club_name: 'Test Club',
        insurance_verified: true,
        insurance_id: 1,
        active: true,
      };

      let createMemberMock: jest.Mock | undefined;

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        createMemberMock = jest.fn().mockResolvedValue(mockMember);
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              name: 'Test Camporee',
              end_date: new Date('2026-06-03'),
              active: true,
            }),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue({ user_id: 'user-uuid' }),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: createMemberMock,
          },
          member_insurances: {
            findUnique: jest.fn().mockResolvedValue(mockInsurance),
          },
        };
        return callback(tx);
      });

      const result = await service.registerMember(1, registerDto);

      expect(result).toEqual(mockMember);
      expect(createMemberMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            insurance_id: 1,
            insurance_verified: true,
          }),
        }),
      );
    });

    it('should throw NotFoundException if camporee not found', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        camporee_type: 'local' as const,
        club_name: 'Test Club',
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        };
        return callback(tx);
      });

      await expect(
        service.registerMember(999, registerDto),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_NOT_FOUND });
    });

    it('should throw BadRequestException if camporee is not active', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        camporee_type: 'local' as const,
        club_name: 'Test Club',
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              active: false,
            }),
          },
        };
        return callback(tx);
      });

      await expect(
        service.registerMember(1, registerDto),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_NOT_ACTIVE });
    });

    it('should throw BadRequestException if insurance type is not eligible for camporees', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        camporee_type: 'local' as const,
        club_name: 'Test Club',
        insurance_id: 1,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              active: true,
              end_date: new Date('2026-06-03'),
            }),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue({ user_id: 'user-uuid' }),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          member_insurances: {
            findUnique: jest.fn().mockResolvedValue({
              insurance_id: 1,
              user_id: 'user-uuid',
              insurance_type: 'HIGH_RISK',
              end_date: new Date('2026-12-31'),
              active: true,
            }),
          },
        };
        return callback(tx);
      });

      await expect(
        service.registerMember(1, registerDto),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_INSURANCE_TYPE_INVALID,
      });
    });

    it('should throw BadRequestException if insurance expires before camporee ends', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        camporee_type: 'local' as const,
        club_name: 'Test Club',
        insurance_id: 1,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              active: true,
              end_date: new Date('2026-06-03'),
            }),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue({ user_id: 'user-uuid' }),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          member_insurances: {
            findUnique: jest.fn().mockResolvedValue({
              insurance_id: 1,
              user_id: 'user-uuid',
              insurance_type: 'CAMPOREE',
              end_date: new Date('2026-06-01'), // Expires before camporee ends
              active: true,
            }),
          },
        };
        return callback(tx);
      });

      await expect(
        service.registerMember(1, registerDto),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_INSURANCE_EXPIRED });
    });
  });

  describe('getMembers', () => {
    it('should return paginated active members of a camporee', async () => {
      const mockCamporee = {
        local_camporee_id: 1,
        name: 'Test Camporee',
        active: true,
        local_fields: {},
        ecclesiastical_year_relation: {},
        attending_members_camporees: [],
      };

      const mockMembers = [
        {
          camporee_member_id: 1,
          camporee_id: 1,
          user_id: 'user-uuid-1',
          active: true,
          users: {
            user_id: 'user-uuid-1',
            name: 'User 1',
            email: 'user1@test.com',
            user_image: null,
          },
          insurance: null,
        },
        {
          camporee_member_id: 2,
          camporee_id: 1,
          user_id: 'user-uuid-2',
          active: true,
          users: {
            user_id: 'user-uuid-2',
            name: 'User 2',
            email: 'user2@test.com',
            user_image: null,
          },
          insurance: {
            insurance_id: 1,
            insurance_type: 'CAMPOREE',
          },
        },
      ];

      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );
      // getMembers uses $transaction([findMany, count]) — mock findMany and count individually
      // $transaction in array form resolves Promise.all, so mock the individual calls
      mockPrismaService.camporee_members.findMany.mockResolvedValue(
        mockMembers,
      );
      mockPrismaService.camporee_members.count.mockResolvedValue(2);

      const result = await service.getMembers(1);

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(50);
      expect(result.meta.totalPages).toBe(1);
      expect(result.meta.hasNextPage).toBe(false);
      expect(result.meta.hasPreviousPage).toBe(false);
    });
  });

  describe('getParticipants (legacy)', () => {
    it('should delegate to getMembers and return paginated result', async () => {
      const mockCamporee = {
        local_camporee_id: 1,
        name: 'Test Camporee',
        active: true,
        local_fields: {},
        ecclesiastical_year_relation: {},
        attending_members_camporees: [],
      };

      const mockMembers = [
        {
          camporee_member_id: 1,
          camporee_id: 1,
          user_id: 'user-uuid-1',
          active: true,
          users: {
            user_id: 'user-uuid-1',
            name: 'User 1',
            user_image: null,
          },
          insurance: null,
        },
      ];

      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );
      // getParticipants delegates to getMembers which uses $transaction([findMany, count])
      // $transaction mock resolves Promise.all — mock the individual calls
      mockPrismaService.camporee_members.findMany.mockResolvedValue(
        mockMembers,
      );
      mockPrismaService.camporee_members.count.mockResolvedValue(1);

      const result = await service.getParticipants(1);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(50);
      expect(result.meta.totalPages).toBe(1);
      expect(result.meta.hasNextPage).toBe(false);
      expect(result.meta.hasPreviousPage).toBe(false);
    });
  });

  describe('getMembers pagination', () => {
    const mockCamporee = {
      local_camporee_id: 1,
      name: 'Test Camporee',
      active: true,
      local_fields: {},
      ecclesiastical_year_relation: {},
      attending_members_camporees: [],
    };

    beforeEach(() => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );
    });

    it('Test A — empty page beyond available data', async () => {
      // count=30 but page 3 with limit 50 → skip=100, no results
      mockPrismaService.camporee_members.findMany.mockResolvedValue([]);
      mockPrismaService.camporee_members.count.mockResolvedValue(30);

      const pagination = Object.assign(new CamporeeMembersListQueryDto(), {
        page: 3,
        limit: 50,
      });
      const result = await service.getMembers(1, undefined, pagination);

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(30);
      expect(result.meta.page).toBe(3);
      expect(result.meta.limit).toBe(50);
      expect(result.meta.totalPages).toBe(1);
      expect(result.meta.hasNextPage).toBe(false);
      expect(result.meta.hasPreviousPage).toBe(true);
    });

    it('Test B — first page with results and multiple pages', async () => {
      const mockMembers = Array.from({ length: 5 }, (_, i) => ({
        camporee_member_id: i + 1,
        camporee_id: 1,
        user_id: `user-uuid-${i + 1}`,
        active: true,
        users: {
          user_id: `user-uuid-${i + 1}`,
          name: `User ${i + 1}`,
          user_image: null,
        },
        insurance: null,
      }));
      // count=120, limit=50 → totalPages=ceil(120/50)=3
      mockPrismaService.camporee_members.findMany.mockResolvedValue(
        mockMembers,
      );
      mockPrismaService.camporee_members.count.mockResolvedValue(120);

      const pagination = Object.assign(new CamporeeMembersListQueryDto(), {
        page: 1,
        limit: 50,
      });
      const result = await service.getMembers(1, undefined, pagination);

      expect(result.data).toHaveLength(5);
      expect(result.meta.total).toBe(120);
      expect(result.meta.totalPages).toBe(3);
      expect(result.meta.hasNextPage).toBe(true);
      expect(result.meta.hasPreviousPage).toBe(false);
    });

    it('Test D — getParticipants delegates to getMembers without in-memory slicing', async () => {
      mockPrismaService.camporee_members.findMany.mockResolvedValue([]);
      mockPrismaService.camporee_members.count.mockResolvedValue(0);

      const getMembers = jest.spyOn(service, 'getMembers');

      const pagination = Object.assign(new CamporeeMembersListQueryDto(), {
        page: 2,
        limit: 10,
      });
      await service.getParticipants(1, pagination);

      expect(getMembers).toHaveBeenCalledWith(1, undefined, pagination);
    });

    it('Test E (smoke) — getMembers returns paginated result for 25 mocked members', async () => {
      const mockMembers = Array.from({ length: 25 }, (_, i) => ({
        camporee_member_id: i + 1,
        camporee_id: 1,
        user_id: `user-uuid-${i + 1}`,
        active: true,
        users: {
          user_id: `user-uuid-${i + 1}`,
          name: `User ${i + 1}`,
          user_image: null,
        },
        insurance: null,
      }));
      mockPrismaService.camporee_members.findMany.mockResolvedValue(
        mockMembers,
      );
      mockPrismaService.camporee_members.count.mockResolvedValue(25);

      const result = await service.getMembers(1);

      expect(result.data).toHaveLength(25);
      expect(result.meta.total).toBe(25);
      expect(result.meta.totalPages).toBe(1);
    });

    it('Test P5.6 — getMembers wraps fan-out in PROFILE_URL_LIMITER (applySignedPrivateUrls called N times)', async () => {
      // applySignedPrivateUrls is private — spy via bracket access to assert
      // the limiter fan-out fires once per member. We cannot assert concurrency
      // cap directly from a module-level const without refactoring injection,
      // so we verify the map was invoked the expected N times as an indirect proxy.
      const memberCount = 25;
      const mockMembers = Array.from({ length: memberCount }, (_, i) => ({
        camporee_member_id: i + 1,
        camporee_id: 1,
        user_id: `user-uuid-${i + 1}`,
        active: true,
        users: {
          user_id: `user-uuid-${i + 1}`,
          name: `User ${i + 1}`,
          user_image: null,
        },
        insurance: null,
      }));
      mockPrismaService.camporee_members.findMany.mockResolvedValue(
        mockMembers,
      );
      mockPrismaService.camporee_members.count.mockResolvedValue(memberCount);

      // Replace applySignedPrivateUrls with a no-op spy that returns the member unchanged.
      // This validates that the PROFILE_URL_LIMITER fan-out invokes it once per member.
      // Note: direct N<=20 concurrency assertion would require injecting the limiter —
      // skipped here to avoid over-engineering; the existing pLimit(20) cap is tested
      // indirectly via the fan-out call count.
      const applySpy = jest
        .spyOn(service as any, 'applySignedPrivateUrls')
        .mockImplementation((member: any) => Promise.resolve(member));

      const result = await service.getMembers(1);

      expect(applySpy).toHaveBeenCalledTimes(memberCount);
      expect(result.data).toHaveLength(memberCount);
    });
  });

  describe('removeMember', () => {
    const mockCamporee = {
      local_camporee_id: 1,
      name: 'Test Camporee',
      active: true,
      local_fields: {},
      ecclesiastical_year_relation: {},
      attending_members_camporees: [],
    };

    const mockRegistration = {
      camporee_member_id: 42,
      camporee_id: 1,
      user_id: 'user-uuid-1',
      active: true,
    };

    it('should soft delete the member registration', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );
      mockPrismaService.camporee_members.findFirst.mockResolvedValue(
        mockRegistration,
      );
      mockPrismaService.camporee_members.update.mockResolvedValue({
        ...mockRegistration,
        active: false,
      });

      const result = await service.removeMember(1, 'user-uuid-1');

      expect(result.active).toBe(false);
      expect(mockPrismaService.camporee_members.update).toHaveBeenCalledWith({
        where: { camporee_member_id: 42 },
        data: expect.objectContaining({ active: false }),
      });
    });

    it('should throw NotFoundException if camporee does not exist', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue(null);

      await expect(
        service.removeMember(999, 'user-uuid-1'),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_NOT_FOUND });
    });

    it('should throw NotFoundException if member is not registered in camporee', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );
      mockPrismaService.camporee_members.findFirst.mockResolvedValue(null);

      await expect(
        service.removeMember(1, 'nonexistent-user'),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_MEMBER_NOT_FOUND });
    });

    it('should search registration with correct filter (active: true)', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );
      mockPrismaService.camporee_members.findFirst.mockResolvedValue(
        mockRegistration,
      );
      mockPrismaService.camporee_members.update.mockResolvedValue({
        ...mockRegistration,
        active: false,
      });

      await service.removeMember(1, 'user-uuid-1');

      expect(mockPrismaService.camporee_members.findFirst).toHaveBeenCalledWith(
        {
          where: {
            camporee_id: 1,
            user_id: 'user-uuid-1',
            active: true,
          },
        },
      );
    });
  });

  describe('registerMember - additional insurance validations', () => {
    it('should throw BadRequestException if user not found', async () => {
      const registerDto = {
        user_id: 'nonexistent-user',
        camporee_type: 'local' as const,
        club_name: 'Test Club',
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              active: true,
              end_date: new Date('2026-06-03'),
            }),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        };
        return callback(tx);
      });

      await expect(
        service.registerMember(1, registerDto),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_USER_NOT_FOUND });
    });

    it('should throw BadRequestException if user is already registered', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        camporee_type: 'local' as const,
        club_name: 'Test Club',
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              active: true,
              end_date: new Date('2026-06-03'),
            }),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue({ user_id: 'user-uuid' }),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue({
              camporee_member_id: 1,
              camporee_id: 1,
              user_id: 'user-uuid',
              active: true,
            }),
          },
        };
        return callback(tx);
      });

      await expect(
        service.registerMember(1, registerDto),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_MEMBER_ALREADY_REGISTERED,
      });
    });

    it('should throw BadRequestException if insurance not found', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        camporee_type: 'local' as const,
        club_name: 'Test Club',
        insurance_id: 999,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              active: true,
              end_date: new Date('2026-06-03'),
            }),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue({ user_id: 'user-uuid' }),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          member_insurances: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
        };
        return callback(tx);
      });

      await expect(
        service.registerMember(1, registerDto),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_INSURANCE_NOT_FOUND });
    });

    it('should throw BadRequestException if insurance belongs to a different user', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        camporee_type: 'local' as const,
        club_name: 'Test Club',
        insurance_id: 1,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              active: true,
              end_date: new Date('2026-06-03'),
            }),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue({ user_id: 'user-uuid' }),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          member_insurances: {
            findUnique: jest.fn().mockResolvedValue({
              insurance_id: 1,
              user_id: 'other-user',
              insurance_type: 'CAMPOREE',
              end_date: new Date('2026-12-31'),
              active: true,
            }),
          },
        };
        return callback(tx);
      });

      await expect(
        service.registerMember(1, registerDto),
      ).rejects.toMatchObject({ code: ErrorCode.CAMPOREE_INSURANCE_NOT_OWNER });
    });

    it('should throw BadRequestException if insurance is not active', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        camporee_type: 'local' as const,
        club_name: 'Test Club',
        insurance_id: 1,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              active: true,
              end_date: new Date('2026-06-03'),
            }),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue({ user_id: 'user-uuid' }),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
          },
          member_insurances: {
            findUnique: jest.fn().mockResolvedValue({
              insurance_id: 1,
              user_id: 'user-uuid',
              insurance_type: 'CAMPOREE',
              end_date: new Date('2026-12-31'),
              active: false,
            }),
          },
        };
        return callback(tx);
      });

      await expect(
        service.registerMember(1, registerDto),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_INSURANCE_NOT_ACTIVE,
      });
    });

    it('should register member without insurance when insurance_id is not provided', async () => {
      const registerDto = {
        user_id: 'user-uuid',
        club_name: 'Test Club',
      };

      const mockMember = {
        camporee_member_id: 5,
        camporee_id: 1,
        user_id: 'user-uuid',
        insurance_verified: false,
        insurance_id: null,
        active: true,
        users: { user_id: 'user-uuid', name: 'Test User', user_image: null },
        insurance: null,
      };

      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue({
              local_camporee_id: 1,
              active: true,
              end_date: new Date('2026-06-03'),
            }),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue({ user_id: 'user-uuid' }),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(mockMember),
          },
        };
        return callback(tx);
      });

      const result = await service.registerMember(1, registerDto);

      expect(result.insurance_verified).toBe(false);
      expect(result.insurance_id).toBeNull();
    });
  });

  describe('uploadPaymentVoucher', () => {
    const CAMPOREE_ID = 7;
    const PAYMENT_ID = '11111111-2222-3333-4444-555555555555';

    const makeFile = (
      overrides: Partial<Express.Multer.File> = {},
    ): Express.Multer.File => ({
      fieldname: 'file',
      originalname: 'receipt.jpg',
      encoding: '7bit',
      mimetype: 'image/jpeg',
      size: 1024,
      buffer: Buffer.from('fake-image-bytes'),
      destination: '',
      filename: 'receipt.jpg',
      path: '',
      stream: undefined as any,
      ...overrides,
    });

    it('uploads a valid file and updates the payment with voucher metadata', async () => {
      const payment = {
        camporee_payment_id: PAYMENT_ID,
        camporee_member_id: 99,
        voucher_url: null,
        voucher_uploaded_at: null,
        camporee_member: {
          camporee_member_id: 99,
          camporee_id: CAMPOREE_ID,
          union_camporee_id: null,
        },
      };

      mockPrismaService.camporee_payments.findUnique.mockResolvedValue(payment);

      mockFileStorageService.upload.mockResolvedValue({
        key: 'camporee-payments/7/.../file.jpg',
        url: 'https://r2.example.com/camporee-payments/7/.../file.jpg',
      });

      mockPrismaService.camporee_payments.update.mockResolvedValue({
        ...payment,
        voucher_url: 'https://r2.example.com/camporee-payments/7/.../file.jpg',
        voucher_uploaded_at: new Date(),
      });

      const file = makeFile();
      const result = await service.uploadPaymentVoucher(
        CAMPOREE_ID,
        PAYMENT_ID,
        file,
      );

      expect(mockFileStorageService.upload).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.camporee_payments.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { camporee_payment_id: PAYMENT_ID },
          data: expect.objectContaining({
            voucher_url:
              'https://r2.example.com/camporee-payments/7/.../file.jpg',
            voucher_uploaded_at: expect.any(Date),
          }),
        }),
      );
      expect(result.voucher_url).toBe(
        'https://r2.example.com/camporee-payments/7/.../file.jpg',
      );
    });

    it('rejects when no file is provided', async () => {
      await expect(
        service.uploadPaymentVoucher(
          CAMPOREE_ID,
          PAYMENT_ID,
          undefined as unknown as Express.Multer.File,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_PAYMENT_VOUCHER_REQUIRED,
      });
      expect(mockFileStorageService.upload).not.toHaveBeenCalled();
    });

    it('rejects oversized files (>10MB)', async () => {
      const file = makeFile({ size: 11 * 1024 * 1024 });
      await expect(
        service.uploadPaymentVoucher(CAMPOREE_ID, PAYMENT_ID, file),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_PAYMENT_VOUCHER_TOO_LARGE,
      });
      expect(mockFileStorageService.upload).not.toHaveBeenCalled();
    });

    it('rejects unsupported mimetypes', async () => {
      const file = makeFile({ mimetype: 'application/zip' });
      await expect(
        service.uploadPaymentVoucher(CAMPOREE_ID, PAYMENT_ID, file),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_PAYMENT_VOUCHER_MIME_INVALID,
      });
      expect(mockFileStorageService.upload).not.toHaveBeenCalled();
    });

    it('throws 404 when payment is not found', async () => {
      mockPrismaService.camporee_payments.findUnique.mockResolvedValue(null);

      await expect(
        service.uploadPaymentVoucher(CAMPOREE_ID, PAYMENT_ID, makeFile()),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_PAYMENT_NOT_FOUND,
      });
      expect(mockFileStorageService.upload).not.toHaveBeenCalled();
    });

    it('rejects when payment belongs to a different camporee', async () => {
      mockPrismaService.camporee_payments.findUnique.mockResolvedValue({
        camporee_payment_id: PAYMENT_ID,
        camporee_member_id: 99,
        voucher_url: null,
        camporee_member: {
          camporee_member_id: 99,
          camporee_id: 999, // different camporee
          union_camporee_id: null,
        },
      });

      await expect(
        service.uploadPaymentVoucher(CAMPOREE_ID, PAYMENT_ID, makeFile()),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_PAYMENT_SCOPE_MISMATCH,
      });
      expect(mockFileStorageService.upload).not.toHaveBeenCalled();
    });
  });

  describe('removePaymentVoucher', () => {
    const CAMPOREE_ID = 7;
    const PAYMENT_ID = '11111111-2222-3333-4444-555555555555';

    it('clears voucher fields and best-effort deletes the R2 object', async () => {
      const payment = {
        camporee_payment_id: PAYMENT_ID,
        camporee_member_id: 99,
        voucher_url: 'https://r2.example.com/camporee-payments/7/x.jpg',
        voucher_uploaded_at: new Date(),
        camporee_member: {
          camporee_member_id: 99,
          camporee_id: CAMPOREE_ID,
          union_camporee_id: null,
        },
      };

      mockPrismaService.camporee_payments.findUnique.mockResolvedValue(payment);
      mockFileStorageService.deleteMany.mockResolvedValue(undefined);
      mockPrismaService.camporee_payments.update.mockResolvedValue({
        ...payment,
        voucher_url: null,
        voucher_uploaded_at: null,
      });

      const result = await service.removePaymentVoucher(
        CAMPOREE_ID,
        PAYMENT_ID,
      );

      expect(mockFileStorageService.deleteMany).toHaveBeenCalledTimes(1);
      expect(mockPrismaService.camporee_payments.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { camporee_payment_id: PAYMENT_ID },
          data: { voucher_url: null, voucher_uploaded_at: null },
        }),
      );
      expect(result.voucher_url).toBeNull();
    });

    it('still clears DB fields when R2 deletion fails', async () => {
      const payment = {
        camporee_payment_id: PAYMENT_ID,
        camporee_member_id: 99,
        voucher_url: 'https://r2.example.com/camporee-payments/7/x.jpg',
        voucher_uploaded_at: new Date(),
        camporee_member: {
          camporee_member_id: 99,
          camporee_id: CAMPOREE_ID,
          union_camporee_id: null,
        },
      };

      mockPrismaService.camporee_payments.findUnique.mockResolvedValue(payment);
      mockFileStorageService.deleteMany.mockRejectedValue(
        new Error('R2 unavailable'),
      );
      mockPrismaService.camporee_payments.update.mockResolvedValue({
        ...payment,
        voucher_url: null,
        voucher_uploaded_at: null,
      });

      const result = await service.removePaymentVoucher(
        CAMPOREE_ID,
        PAYMENT_ID,
      );
      expect(result.voucher_url).toBeNull();
    });
  });
  describe('club registration closure', () => {
    it('closes local club registration when enrolled sections exist', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue({
        local_camporee_id: 1,
        active: true,
        club_registration_closed_at: null,
      });
      mockPrismaService.camporee_clubs.count.mockResolvedValue(1);
      mockPrismaService.local_camporees.update.mockResolvedValue({
        local_camporee_id: 1,
        club_registration_closed_at: new Date('2026-07-01T00:00:00.000Z'),
      });

      await service.closeLocalCamporeeClubRegistration(
        1,
        '11111111-1111-4111-8111-111111111111',
      );

      expect(mockPrismaService.local_camporees.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { local_camporee_id: 1 },
          data: expect.objectContaining({
            club_registration_closed_at: expect.any(Date),
            club_registration_closed_by: '11111111-1111-4111-8111-111111111111',
          }),
        }),
      );
    });

    it('refuses to close local club registration without enrolled sections', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue({
        local_camporee_id: 1,
        active: true,
        club_registration_closed_at: null,
      });
      mockPrismaService.camporee_clubs.count.mockResolvedValue(0);

      await expect(
        service.closeLocalCamporeeClubRegistration(
          1,
          '11111111-1111-4111-8111-111111111111',
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_CLUB_REGISTRATION_NO_ENROLLED_CLUBS,
      });
    });

    it('refuses to reopen local club registration when scoring exists', async () => {
      mockPrismaService.local_camporees.findUnique.mockResolvedValue({
        local_camporee_id: 1,
        name: 'Camporee',
      });
      mockPrismaService.camporee_event_section_results.count.mockResolvedValue(
        1,
      );
      mockPrismaService.camporee_event_judge_assignments.count.mockResolvedValue(
        0,
      );

      await expect(
        service.reopenLocalCamporeeClubRegistration(
          1,
          '11111111-1111-4111-8111-111111111111',
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.CAMPOREE_CLUB_REGISTRATION_REOPEN_BLOCKED,
      });
    });
  });
});
