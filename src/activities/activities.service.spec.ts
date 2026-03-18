import { Test, TestingModule } from '@nestjs/testing';
import { ActivitiesService } from './activities.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';

describe('ActivitiesService', () => {
  let service: ActivitiesService;

  const mockPrismaService = {
    activities: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    clubs: {
      findUnique: jest.fn(),
    },
    club_sections: {
      findUnique: jest.fn(),
    },
    users: {
      findMany: jest.fn(),
    },
  };

  const mockFileStorageService = {
    getSignedDownloadUrl: jest.fn(
      async (_bucket: StorageBucketAlias, value: string) => value,
    ),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
      ],
    }).compile();

    service = module.get<ActivitiesService>(ActivitiesService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByClub', () => {
    it('should return paginated activities for a club', async () => {
      const mockClub = {
        club_id: 1,
        club_sections: [
          { club_section_id: 1, club_type_id: 1 },
          { club_section_id: 2, club_type_id: 2 },
        ],
      };
      const mockActivities = [
        { activity_id: 1, name: 'Campamento', active: true },
      ];

      mockPrismaService.clubs.findUnique.mockResolvedValue(mockClub);
      mockPrismaService.activities.findMany.mockResolvedValue(mockActivities);
      mockPrismaService.activities.count.mockResolvedValue(1);

      const result = await service.findByClub(1);

      expect(result.data).toEqual([{ ...mockActivities[0], instances: [] }]);
      expect(result.meta.total).toBe(1);
    });

    it('should throw NotFoundException when club not found', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue(null);

      await expect(service.findByClub(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOne', () => {
    it('should return activity by id', async () => {
      const mockActivity = { activity_id: 1, name: 'Campamento' };
      mockPrismaService.activities.findUnique.mockResolvedValue(mockActivity);

      const result = await service.findOne(1);

      const { activity_instances: _ignored, ...rest } = mockActivity as any;
      expect(result).toEqual({ ...rest, instances: [] });
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrismaService.activities.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create an activity with a club_section_id', async () => {
      const createDto = {
        name: 'Campamento',
        club_type_id: 1,
        lat: 19.4326,
        long: -99.1332,
        activity_place: 'Parque Nacional',
        image: 'https://example.com/image.jpg',
        activity_type_id: 1,
        club_section_id: 10,
      };

      const mockActivity = {
        activity_id: 1,
        ...createDto,
        activity_instances: [],
      };

      mockPrismaService.clubs.findUnique.mockResolvedValue({ club_id: 1 });
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        main_club_id: 1,
        club_type_id: 1,
      });
      mockPrismaService.activities.create.mockResolvedValue(mockActivity);

      const result = await service.create(1, createDto, 'user-123');

      expect(mockPrismaService.activities.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            club_section_id: 10,
            activity_instances: {
              create: [
                expect.objectContaining({ club_section_id: 10 }),
              ],
            },
          }),
        }),
      );
      const { activity_instances: _ignored, ...rest } = mockActivity as any;
      expect(result).toEqual({ ...rest, instances: [] });
    });

    it('should throw when no club_section_id is provided', async () => {
      const createDto = {
        name: 'Campamento',
        club_type_id: 2,
        lat: 19.4326,
        long: -99.1332,
        activity_place: 'Parque Nacional',
        image: 'https://example.com/image.jpg',
        activity_type_id: 1,
      };

      mockPrismaService.clubs.findUnique.mockResolvedValue({ club_id: 1 });
      mockPrismaService.club_sections.findUnique.mockResolvedValue(null);

      await expect(
        service.create(1, createDto as any, 'user-123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when section does not belong to club', async () => {
      const createDto = {
        name: 'Campamento',
        club_type_id: 2,
        lat: 19.4326,
        long: -99.1332,
        activity_place: 'Parque Nacional',
        image: 'https://example.com/image.jpg',
        activity_type_id: 1,
        club_section_id: 999,
      };

      mockPrismaService.clubs.findUnique.mockResolvedValue({ club_id: 1 });
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        main_club_id: 2,
        club_type_id: 2,
      });

      await expect(
        service.create(1, createDto as any, 'user-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('recordAttendance', () => {
    it('should record attendance for an activity', async () => {
      const mockActivity = { activity_id: 1, name: 'Campamento' };
      const attendees = ['user-1', 'user-2', 'user-3'];

      mockPrismaService.activities.findUnique.mockResolvedValue(mockActivity);
      mockPrismaService.activities.update.mockResolvedValue({
        ...mockActivity,
        attendees,
      });

      const result = await service.recordAttendance(1, { user_ids: attendees });

      expect(result.attendees).toEqual(attendees);
    });
  });

  describe('getAttendance', () => {
    it('should return attendance list', async () => {
      const mockActivity = {
        activity_id: 1,
        name: 'Campamento',
        attendees: ['user-1', 'user-2'],
      };
      const mockUsers = [
        { user_id: 'user-1', name: 'Juan' },
        { user_id: 'user-2', name: 'María' },
      ];

      mockPrismaService.activities.findUnique.mockResolvedValue(mockActivity);
      mockPrismaService.users.findMany.mockResolvedValue(mockUsers);

      const result = await service.getAttendance(1);

      expect(result.total_attendees).toBe(2);
      expect(result.attendees).toEqual(mockUsers);
    });
  });
});
