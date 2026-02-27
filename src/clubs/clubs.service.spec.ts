import { Test, TestingModule } from '@nestjs/testing';
import { ClubsService } from './clubs.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

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
    },
    club_adventurers: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    club_pathfinders: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    club_master_guilds: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    club_role_assignments: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubsService,
        { provide: PrismaService, useValue: mockPrismaService },
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

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
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

  describe('getInstances', () => {
    it('should include club_type_name in each returned instance', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue({
        club_id: 10,
        name: 'Club Norte',
      });
      mockPrismaService.club_adventurers.findMany.mockResolvedValue([
        {
          club_adv_id: 1,
          club_type_id: 2,
          active: true,
          club_types: { name: 'Aventureros' },
        },
      ]);
      mockPrismaService.club_pathfinders.findMany.mockResolvedValue([
        {
          club_pathf_id: 2,
          club_type_id: 3,
          active: true,
          club_types: { name: 'Conquistadores' },
        },
      ]);
      mockPrismaService.club_master_guilds.findMany.mockResolvedValue([
        {
          club_mg_id: 3,
          club_type_id: 4,
          active: true,
          club_types: { name: 'Guías Mayores' },
        },
      ]);

      const result = await service.getInstances(10);

      expect(result).toEqual({
        adventurers: [
          expect.objectContaining({
            club_adv_id: 1,
            club_type_name: 'Aventureros',
          }),
        ],
        pathfinders: [
          expect.objectContaining({
            club_pathf_id: 2,
            club_type_name: 'Conquistadores',
          }),
        ],
        master_guilds: [
          expect.objectContaining({
            club_mg_id: 3,
            club_type_name: 'Guías Mayores',
          }),
        ],
      });
    });
  });
});
