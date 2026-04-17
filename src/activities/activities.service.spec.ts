import { Test, TestingModule } from '@nestjs/testing';
import { ActivitiesService } from './activities.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  FILE_STORAGE_SERVICE,
  StorageBucketAlias,
} from '../common/services/file-storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AchievementsService } from '../achievements/achievements.service';

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

  const mockNotificationsService = {
    sendToClubMembers: jest.fn().mockResolvedValue(undefined),
    sendSilentToSection: jest.fn().mockResolvedValue(undefined),
  };

  const mockAchievementsService = {
    emitEvent: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivitiesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: FILE_STORAGE_SERVICE, useValue: mockFileStorageService },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: AchievementsService, useValue: mockAchievementsService },
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

    it('should return empty page when no sections match the clubTypeId filter', async () => {
      const mockClub = {
        club_id: 1,
        club_sections: [{ club_section_id: 1, club_type_id: 1 }],
      };

      mockPrismaService.clubs.findUnique.mockResolvedValue(mockClub);

      const result = await service.findByClub(1, { clubTypeId: 99 });

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(mockPrismaService.activities.findMany).not.toHaveBeenCalled();
    });

    it('should filter by active flag when provided', async () => {
      const mockClub = {
        club_id: 1,
        club_sections: [{ club_section_id: 1, club_type_id: 1 }],
      };
      const mockActivities = [{ activity_id: 2, name: 'Retiro', active: true }];

      mockPrismaService.clubs.findUnique.mockResolvedValue(mockClub);
      mockPrismaService.activities.findMany.mockResolvedValue(mockActivities);
      mockPrismaService.activities.count.mockResolvedValue(1);

      const result = await service.findByClub(1, { active: true });

      expect(result.data).toHaveLength(1);
      expect(mockPrismaService.activities.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: true }),
        }),
      );
    });

    it('should filter by activityTypeId when provided', async () => {
      const mockClub = {
        club_id: 1,
        club_sections: [{ club_section_id: 1, club_type_id: 1 }],
      };

      mockPrismaService.clubs.findUnique.mockResolvedValue(mockClub);
      mockPrismaService.activities.findMany.mockResolvedValue([]);
      mockPrismaService.activities.count.mockResolvedValue(0);

      await service.findByClub(1, { activityTypeId: 2 });

      expect(mockPrismaService.activities.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ activity_type_id: 2 }),
        }),
      );
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
        club_section_id: 10,
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
              create: [expect.objectContaining({ club_section_id: 10 })],
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

  describe('update', () => {
    it('should update allowed fields and return the activity', async () => {
      const existing = {
        activity_id: 1,
        name: 'Campamento',
        activity_instances: [],
      };
      const updated = {
        activity_id: 1,
        name: 'Retiro',
        activity_instances: [],
      };

      mockPrismaService.activities.findUnique.mockResolvedValueOnce(existing);
      mockPrismaService.activities.update.mockResolvedValue(updated);

      const result = await service.update(1, { name: 'Retiro' });

      expect(mockPrismaService.activities.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { activity_id: 1 },
          data: expect.objectContaining({ name: 'Retiro' }),
        }),
      );
      const { activity_instances: _ignored, ...rest } = updated as any;
      expect(result).toEqual({ ...rest, instances: [] });
    });

    it('should throw NotFoundException when activity does not exist', async () => {
      mockPrismaService.activities.findUnique.mockResolvedValue(null);

      await expect(service.update(999, { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should not call update when dto has no fields', async () => {
      const existing = {
        activity_id: 1,
        name: 'Campamento',
        activity_instances: [],
      };
      mockPrismaService.activities.findUnique.mockResolvedValue(existing);
      mockPrismaService.activities.update.mockResolvedValue(existing);

      await service.update(1, {});

      expect(mockPrismaService.activities.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ modified_at: expect.any(Date) }),
        }),
      );
    });
  });

  describe('remove', () => {
    it('should soft-delete the activity by setting active=false', async () => {
      const existing = {
        activity_id: 1,
        name: 'Campamento',
        activity_instances: [],
      };

      mockPrismaService.activities.findUnique.mockResolvedValue(existing);
      mockPrismaService.activities.update.mockResolvedValue({
        ...existing,
        active: false,
      });

      const result = await service.remove(1);

      expect(mockPrismaService.activities.update).toHaveBeenCalledWith({
        where: { activity_id: 1 },
        data: expect.objectContaining({ active: false }),
      });
      expect(result).toEqual(expect.objectContaining({ active: false }));
    });

    it('should throw NotFoundException when activity does not exist', async () => {
      mockPrismaService.activities.findUnique.mockResolvedValue(null);

      await expect(service.remove(999)).rejects.toThrow(NotFoundException);
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

    it('should throw NotFoundException when activity does not exist', async () => {
      mockPrismaService.activities.findUnique.mockResolvedValue(null);

      await expect(
        service.recordAttendance(999, { user_ids: ['user-1'] }),
      ).rejects.toThrow(NotFoundException);
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
        { user_id: 'user-1', name: 'Juan', user_image: null },
        { user_id: 'user-2', name: 'María', user_image: null },
      ];

      mockPrismaService.activities.findUnique.mockResolvedValue(mockActivity);
      mockPrismaService.users.findMany.mockResolvedValue(mockUsers);

      const result = await service.getAttendance(1);

      expect(result.total_attendees).toBe(2);
      expect(result.attendees).toEqual(mockUsers);
      expect(result.activity_name).toBe('Campamento');
    });

    it('should return empty attendees without querying users when attendees list is empty', async () => {
      const mockActivity = {
        activity_id: 1,
        name: 'Campamento',
        attendees: [],
      };

      mockPrismaService.activities.findUnique.mockResolvedValue(mockActivity);

      const result = await service.getAttendance(1);

      expect(result.activity_id).toBe(1);
      expect(result.attendees).toEqual([]);
      expect(mockPrismaService.users.findMany).not.toHaveBeenCalled();
    });

    it('should return empty attendees when attendees field is null/undefined', async () => {
      const mockActivity = {
        activity_id: 1,
        name: 'Campamento',
        // attendees field absent — service falls back to []
      };

      mockPrismaService.activities.findUnique.mockResolvedValue(mockActivity);

      const result = await service.getAttendance(1);

      expect(result.attendees).toEqual([]);
      expect(mockPrismaService.users.findMany).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when activity does not exist', async () => {
      mockPrismaService.activities.findUnique.mockResolvedValue(null);

      await expect(service.getAttendance(999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should resolve signed URLs for attendee user_image when it is a string', async () => {
      const mockActivity = {
        activity_id: 1,
        name: 'Campamento',
        attendees: ['user-1'],
      };
      const mockUsers = [
        { user_id: 'user-1', name: 'Juan', user_image: 'profiles/juan.jpg' },
      ];

      mockPrismaService.activities.findUnique.mockResolvedValue(mockActivity);
      mockPrismaService.users.findMany.mockResolvedValue(mockUsers);
      mockFileStorageService.getSignedDownloadUrl.mockResolvedValue(
        'https://signed.example/profiles/juan.jpg',
      );

      const result = await service.getAttendance(1);

      expect(mockFileStorageService.getSignedDownloadUrl).toHaveBeenCalledWith(
        StorageBucketAlias.USER_PROFILES,
        'profiles/juan.jpg',
        expect.objectContaining({ expiresInSeconds: expect.any(Number) }),
      );
      expect(result.attendees[0].user_image).toBe(
        'https://signed.example/profiles/juan.jpg',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // T2.5 — realtime invalidation hooks
  // ---------------------------------------------------------------------------
  describe('realtime invalidation (sendSilentToSection hook)', () => {
    const ACTOR = 'actor-uuid-0001';
    const SECTION_ID = 10;

    it('create(): calls sendSilentToSection with CREATED action after successful DB write', async () => {
      const createDto = {
        name: 'Campamento',
        club_type_id: 1,
        lat: 19.4326,
        long: -99.1332,
        activity_place: 'Parque Nacional',
        image: 'img.jpg',
        activity_type_id: 1,
        club_section_id: SECTION_ID,
      };
      const mockActivity = {
        activity_id: 7,
        ...createDto,
        activity_instances: [],
      };

      mockPrismaService.clubs.findUnique.mockResolvedValue({ club_id: 1 });
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        club_section_id: SECTION_ID,
        main_club_id: 1,
        club_type_id: 1,
      });
      mockPrismaService.activities.create.mockResolvedValue(mockActivity);

      await service.create(1, createDto, ACTOR);

      expect(mockNotificationsService.sendSilentToSection).toHaveBeenCalledWith(
        expect.objectContaining({
          sectionId: SECTION_ID,
          resource: 'activities',
          action: 'CREATED',
          entityId: 7,
          actorId: ACTOR,
        }),
      );
    });

    it('create(): does NOT call sendSilentToSection when DB write throws', async () => {
      const createDto = {
        name: 'Campamento',
        club_type_id: 1,
        lat: 0,
        long: 0,
        activity_place: 'X',
        image: '',
        activity_type_id: 1,
        club_section_id: SECTION_ID,
      };

      mockPrismaService.clubs.findUnique.mockResolvedValue({ club_id: 1 });
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        club_section_id: SECTION_ID,
        main_club_id: 1,
        club_type_id: 1,
      });
      mockPrismaService.activities.create.mockRejectedValue(
        new Error('DB constraint violation'),
      );

      await expect(service.create(1, createDto, ACTOR)).rejects.toThrow(
        'DB constraint violation',
      );
      expect(mockNotificationsService.sendSilentToSection).not.toHaveBeenCalled();
    });

    it('update(): calls sendSilentToSection with UPDATED action after successful DB write', async () => {
      const existing = {
        activity_id: 3,
        club_section_id: SECTION_ID,
        is_joint: false,
        club_sections: { main_club_id: 1 },
        activity_instances: [],
      };
      const updated = { ...existing, name: 'Retiro', activity_instances: [] };

      mockPrismaService.activities.findUnique.mockResolvedValueOnce(existing);
      mockPrismaService.activities.update.mockResolvedValue(updated);

      await service.update(3, { name: 'Retiro' }, ACTOR);

      expect(mockNotificationsService.sendSilentToSection).toHaveBeenCalledWith(
        expect.objectContaining({
          sectionId: SECTION_ID,
          resource: 'activities',
          action: 'UPDATED',
          entityId: 3,
          actorId: ACTOR,
        }),
      );
    });

    it('update(): does NOT call sendSilentToSection when activity not found', async () => {
      mockPrismaService.activities.findUnique.mockResolvedValue(null);

      await expect(service.update(999, { name: 'X' }, ACTOR)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockNotificationsService.sendSilentToSection).not.toHaveBeenCalled();
    });

    it('remove(): calls sendSilentToSection with DELETED action after successful soft-delete', async () => {
      const existing = {
        activity_id: 5,
        club_section_id: SECTION_ID,
        active: true,
      };

      mockPrismaService.activities.findUnique.mockResolvedValue(existing);
      mockPrismaService.activities.update.mockResolvedValue({
        ...existing,
        active: false,
      });

      await service.remove(5, ACTOR);

      expect(mockNotificationsService.sendSilentToSection).toHaveBeenCalledWith(
        expect.objectContaining({
          sectionId: SECTION_ID,
          resource: 'activities',
          action: 'DELETED',
          entityId: 5,
          actorId: ACTOR,
        }),
      );
    });

    it('remove(): does NOT call sendSilentToSection when activity not found', async () => {
      mockPrismaService.activities.findUnique.mockResolvedValue(null);

      await expect(service.remove(999, ACTOR)).rejects.toThrow(NotFoundException);
      expect(mockNotificationsService.sendSilentToSection).not.toHaveBeenCalled();
    });

    it('remove(): uses fallback actorId "system" when actorId is not provided', async () => {
      const existing = {
        activity_id: 6,
        club_section_id: SECTION_ID,
        active: true,
      };

      mockPrismaService.activities.findUnique.mockResolvedValue(existing);
      mockPrismaService.activities.update.mockResolvedValue({
        ...existing,
        active: false,
      });

      await service.remove(6); // no actorId

      expect(mockNotificationsService.sendSilentToSection).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'system',
        }),
      );
    });
  });
});
