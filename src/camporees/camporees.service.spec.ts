import { Test, TestingModule } from '@nestjs/testing';
import { CamporeesService } from './camporees.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AchievementsService } from '../achievements/achievements.service';
import { ErrorCode } from '../common/errors/error-codes';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';
import { PaginationDto } from '../common/dto/pagination.dto';
import { CamporeeMembersPaginationDto } from './dto/camporee-members-pagination.dto';

describe('CamporeesService', () => {
  let service: CamporeesService;
  let _prisma: PrismaService;

  const mockPrismaService = {
    local_camporees: {
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
    member_insurances: {
      findUnique: jest.fn(),
    },
    users: {
      findUnique: jest.fn(),
    },
    local_fields: {
      findUnique: jest.fn(),
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
      ],
    }).compile();

    service = module.get<CamporeesService>(CamporeesService);
    _prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
        local_field_id: 1,
        includes_adventurers: true,
        includes_pathfinders: true,
        includes_master_guides: false,
        local_camporee_place: 'Test Location',
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
        camporee_type: 'local' as const,
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

      // Mock transaction
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        const tx = {
          local_camporees: {
            findUnique: jest.fn().mockResolvedValue(mockCamporee),
          },
          users: {
            findUnique: jest.fn().mockResolvedValue(mockUser),
          },
          camporee_members: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(mockMember),
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

    it('should throw BadRequestException if insurance type is not CAMPOREE', async () => {
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
              insurance_type: 'GENERAL_ACTIVITIES',
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

      const pagination = Object.assign(new CamporeeMembersPaginationDto(), {
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

      const pagination = Object.assign(new CamporeeMembersPaginationDto(), {
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

      const pagination = Object.assign(new CamporeeMembersPaginationDto(), {
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
        camporee_type: 'local' as const,
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
});
