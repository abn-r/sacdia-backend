import { Test, TestingModule } from '@nestjs/testing';
import { CamporeesService } from './camporees.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { FILE_STORAGE_SERVICE } from '../common/services/file-storage.service';

describe('CamporeesService', () => {
  let service: CamporeesService;
  let prisma: PrismaService;

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
    getSignedDownloadUrl: jest.fn(async (_bucket: unknown, value: string) => value),
  };

  beforeEach(async () => {
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
      ],
    }).compile();

    service = module.get<CamporeesService>(CamporeesService);
    prisma = module.get<PrismaService>(PrismaService);
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

      const result = await service.findAll({}, { page: 1, limit: 20 });

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

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
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

      await expect(service.create(createDto, 'user1')).rejects.toThrow(
        BadRequestException,
      );
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

      await expect(service.create(createDto, 'user1')).rejects.toThrow(
        BadRequestException,
      );
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

      await expect(service.update(999, { name: 'Test' })).rejects.toThrow(
        NotFoundException,
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

      await expect(service.registerMember(999, registerDto)).rejects.toThrow(
        NotFoundException,
      );
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

      await expect(service.registerMember(1, registerDto)).rejects.toThrow(
        BadRequestException,
      );
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

      await expect(service.registerMember(1, registerDto)).rejects.toThrow(
        BadRequestException,
      );
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

      await expect(service.registerMember(1, registerDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getMembers', () => {
    it('should return all active members of a camporee', async () => {
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
      mockPrismaService.camporee_members.findMany.mockResolvedValue(
        mockMembers,
      );

      const result = await service.getMembers(1);

      expect(result).toEqual(mockMembers);
      expect(mockPrismaService.camporee_members.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            camporee_id: 1,
            active: true,
          },
        }),
      );
    });
  });

  describe('getParticipants (legacy)', () => {
    it('should return paginated members', async () => {
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
          },
          insurance: null,
        },
      ];

      mockPrismaService.local_camporees.findUnique.mockResolvedValue(
        mockCamporee,
      );
      mockPrismaService.camporee_members.findMany.mockResolvedValue(
        mockMembers,
      );

      const result = await service.getParticipants(1);

      expect(result.data).toEqual(mockMembers);
      expect(result.meta.total).toBe(1);
    });
  });
});
