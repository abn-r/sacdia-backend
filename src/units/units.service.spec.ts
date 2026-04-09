import { Test, TestingModule } from '@nestjs/testing';
import { UnitsService } from './units.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringCategoriesService } from '../scoring-categories/scoring-categories.service';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';

describe('UnitsService', () => {
  let service: UnitsService;

  const mockPrismaService = {
    clubs: {
      findUnique: jest.fn(),
    },
    club_sections: {
      findUnique: jest.fn(),
    },
    units: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    unit_members: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    users: {
      findUnique: jest.fn(),
    },
    weekly_records: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    weekly_record_scores: {
      createMany: jest.fn(),
      upsert: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((cb) => cb(mockPrismaService)),
  };

  const mockScoringCategoriesService = {
    getActiveCategoriesForLocalField: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UnitsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ScoringCategoriesService, useValue: mockScoringCategoriesService },
      ],
    }).compile();

    service = module.get<UnitsService>(UnitsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ========================================
  // findByClub
  // ========================================

  describe('findByClub', () => {
    it('should return units for a club', async () => {
      const mockClub = {
        club_id: 1,
        club_sections: [{ club_section_id: 10 }],
      };
      const mockUnits = [{ unit_id: 1, name: 'Falange Norte', active: true }];

      mockPrismaService.clubs.findUnique.mockResolvedValue(mockClub);
      mockPrismaService.units.findMany.mockResolvedValue(mockUnits);

      const result = await service.findByClub(1);

      expect(result).toEqual(mockUnits);
      expect(mockPrismaService.units.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ active: true }),
        }),
      );
    });

    it('should throw NotFoundException when club does not exist', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue(null);

      await expect(service.findByClub(999)).rejects.toThrow(NotFoundException);
    });

    it('should query without section filter when club has no sections', async () => {
      const mockClub = { club_id: 1, club_sections: [] };
      mockPrismaService.clubs.findUnique.mockResolvedValue(mockClub);
      mockPrismaService.units.findMany.mockResolvedValue([]);

      const result = await service.findByClub(1);

      expect(result).toEqual([]);
      expect(mockPrismaService.units.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            club_section_id: expect.anything(),
          }),
        }),
      );
    });
  });

  // ========================================
  // findOne
  // ========================================

  describe('findOne', () => {
    it('should return a unit by id', async () => {
      const mockUnit = { unit_id: 1, name: 'Falange Norte', unit_members: [] };
      mockPrismaService.units.findUnique.mockResolvedValue(mockUnit);

      const result = await service.findOne(1);

      expect(result).toEqual(mockUnit);
    });

    it('should throw NotFoundException when unit does not exist', async () => {
      mockPrismaService.units.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  // ========================================
  // create
  // ========================================

  describe('create', () => {
    const createDto = {
      name: 'Falange Norte',
      captain_id: 'uuid-captain',
      secretary_id: 'uuid-secretary',
      advisor_id: 'uuid-advisor',
      club_type_id: 2,
      club_section_id: 10,
    };

    it('should create a unit', async () => {
      const mockUnit = { unit_id: 1, ...createDto, active: true };

      mockPrismaService.clubs.findUnique.mockResolvedValue({ club_id: 1 });
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        main_club_id: 1,
      });
      mockPrismaService.units.create.mockResolvedValue(mockUnit);

      const result = await service.create(1, createDto);

      expect(result).toEqual(mockUnit);
      expect(mockPrismaService.units.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Falange Norte',
            active: true,
          }),
        }),
      );
    });

    it('should throw NotFoundException when club does not exist', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue(null);

      await expect(service.create(999, createDto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when section does not exist', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue({ club_id: 1 });
      mockPrismaService.club_sections.findUnique.mockResolvedValue(null);

      await expect(service.create(1, createDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException when section belongs to a different club', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue({ club_id: 1 });
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        main_club_id: 99,
      });

      await expect(service.create(1, createDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should create a unit without club_section_id', async () => {
      const dtoWithoutSection = { ...createDto };
      delete (dtoWithoutSection as any).club_section_id;

      const mockUnit = { unit_id: 2, ...dtoWithoutSection, active: true };
      mockPrismaService.clubs.findUnique.mockResolvedValue({ club_id: 1 });
      mockPrismaService.units.create.mockResolvedValue(mockUnit);

      const result = await service.create(1, dtoWithoutSection);

      expect(result).toEqual(mockUnit);
      expect(mockPrismaService.club_sections.findUnique).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // update
  // ========================================

  describe('update', () => {
    it('should update allowed fields', async () => {
      const existing = { unit_id: 1, name: 'Falange Norte', unit_members: [] };
      const updated = { unit_id: 1, name: 'Falange Sur', unit_members: [] };

      mockPrismaService.units.findUnique.mockResolvedValue(existing);
      mockPrismaService.units.update.mockResolvedValue(updated);

      const result = await service.update(1, { name: 'Falange Sur' });

      expect(result).toEqual(updated);
      expect(mockPrismaService.units.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { unit_id: 1 },
          data: expect.objectContaining({ name: 'Falange Sur' }),
        }),
      );
    });

    it('should throw NotFoundException when unit does not exist', async () => {
      mockPrismaService.units.findUnique.mockResolvedValue(null);

      await expect(service.update(999, { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ========================================
  // remove
  // ========================================

  describe('remove', () => {
    it('should soft-delete the unit', async () => {
      const existing = { unit_id: 1, name: 'Falange Norte', unit_members: [] };

      mockPrismaService.units.findUnique.mockResolvedValue(existing);
      mockPrismaService.units.update.mockResolvedValue({
        ...existing,
        active: false,
      });

      const result = await service.remove(1);

      expect(mockPrismaService.units.update).toHaveBeenCalledWith({
        where: { unit_id: 1 },
        data: expect.objectContaining({ active: false }),
      });
      expect(result).toEqual(expect.objectContaining({ active: false }));
    });

    it('should throw NotFoundException when unit does not exist', async () => {
      mockPrismaService.units.findUnique.mockResolvedValue(null);

      await expect(service.remove(999)).rejects.toThrow(NotFoundException);
    });
  });

  // ========================================
  // addMember
  // ========================================

  describe('addMember', () => {
    const dto = { user_id: 'uuid-user-1' };

    it('should add a new member to the unit', async () => {
      const mockUnit = { unit_id: 1, unit_members: [] };
      const mockMember = {
        unit_member_id: 1,
        unit_id: 1,
        user_id: dto.user_id,
        active: true,
      };

      mockPrismaService.units.findUnique.mockResolvedValue(mockUnit);
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: dto.user_id,
      });
      // No club_section_id on the unit → cross-section check is skipped.
      // Only one findFirst fires: check existing membership in THIS unit (null = new member).
      mockPrismaService.unit_members.findFirst.mockResolvedValueOnce(null);
      mockPrismaService.unit_members.create.mockResolvedValue(mockMember);

      const result = await service.addMember(1, dto);

      expect(result).toEqual(mockMember);
      expect(mockPrismaService.unit_members.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            unit_id: 1,
            user_id: dto.user_id,
            active: true,
          }),
        }),
      );
    });

    it('should reactivate an inactive member', async () => {
      const mockUnit = { unit_id: 1, club_section_id: 10, unit_members: [] };
      const existingInactive = {
        unit_member_id: 5,
        unit_id: 2,
        user_id: dto.user_id,
        active: false,
      };
      const reactivated = { ...existingInactive, unit_id: 1, active: true };

      mockPrismaService.units.findUnique.mockResolvedValue(mockUnit);
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: dto.user_id,
      });
      // First findFirst: cross-section conflict check (null = no conflict in section 10)
      // Second findFirst: finds the inactive membership in THIS unit
      mockPrismaService.unit_members.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingInactive);
      mockPrismaService.unit_members.update.mockResolvedValue(reactivated);

      const result = await service.addMember(1, dto);

      expect(result).toEqual(reactivated);
      expect(mockPrismaService.unit_members.update).toHaveBeenCalled();
    });

    it('should throw ConflictException when user is already an active member', async () => {
      const mockUnit = { unit_id: 1, club_section_id: 10, unit_members: [] };
      const existingActive = {
        unit_member_id: 5,
        unit_id: 1,
        user_id: dto.user_id,
        active: true,
      };

      mockPrismaService.units.findUnique.mockResolvedValue(mockUnit);
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: dto.user_id,
      });
      // First findFirst: cross-section conflict check (null = no conflict in section 10)
      // Second findFirst: finds the active membership in THIS unit → triggers ConflictException
      mockPrismaService.unit_members.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingActive);

      await expect(service.addMember(1, dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw NotFoundException when unit does not exist', async () => {
      mockPrismaService.units.findUnique.mockResolvedValue(null);

      await expect(service.addMember(999, dto)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrismaService.units.findUnique.mockResolvedValue({
        unit_id: 1,
        unit_members: [],
      });
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(service.addMember(1, dto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ========================================
  // removeMember
  // ========================================

  describe('removeMember', () => {
    it('should soft-delete a member', async () => {
      const mockUnit = { unit_id: 1, unit_members: [] };
      const mockMember = {
        unit_member_id: 5,
        unit_id: 1,
        user_id: 'uuid-user',
        active: true,
      };

      mockPrismaService.units.findUnique.mockResolvedValue(mockUnit);
      mockPrismaService.unit_members.findFirst.mockResolvedValue(mockMember);
      mockPrismaService.unit_members.update.mockResolvedValue({
        ...mockMember,
        active: false,
      });

      const result = await service.removeMember(1, 5);

      expect(mockPrismaService.unit_members.update).toHaveBeenCalledWith({
        where: { unit_member_id: 5 },
        data: expect.objectContaining({ active: false }),
      });
      expect(result).toEqual(expect.objectContaining({ active: false }));
    });

    it('should throw NotFoundException when member not found in unit', async () => {
      mockPrismaService.units.findUnique.mockResolvedValue({
        unit_id: 1,
        unit_members: [],
      });
      mockPrismaService.unit_members.findFirst.mockResolvedValue(null);

      await expect(service.removeMember(1, 999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ========================================
  // findWeeklyRecords
  // ========================================

  describe('findWeeklyRecords', () => {
    it('should return weekly records for unit members', async () => {
      const mockUnit = {
        unit_id: 1,
        unit_members: [
          { user_id: 'uuid-user-1', active: true },
          { user_id: 'uuid-user-2', active: true },
        ],
      };
      const mockRecords = [
        {
          record_id: 1,
          user_id: 'uuid-user-1',
          week: 1,
          points: 10,
          weekly_record_scores: [],
        },
      ];

      mockPrismaService.units.findUnique.mockResolvedValue(mockUnit);
      mockPrismaService.weekly_records.findMany.mockResolvedValue(mockRecords);

      const result = await service.findWeeklyRecords(1);

      // transformWeeklyRecord strips weekly_record_scores and adds scores: []
      expect(result).toEqual([
        { record_id: 1, user_id: 'uuid-user-1', week: 1, points: 10, scores: [] },
      ]);
    });

    it('should return empty array when unit has no active members', async () => {
      const mockUnit = { unit_id: 1, unit_members: [] };
      mockPrismaService.units.findUnique.mockResolvedValue(mockUnit);

      const result = await service.findWeeklyRecords(1);

      expect(result).toEqual([]);
      expect(mockPrismaService.weekly_records.findMany).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when unit does not exist', async () => {
      mockPrismaService.units.findUnique.mockResolvedValue(null);

      await expect(service.findWeeklyRecords(999)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ========================================
  // createWeeklyRecord
  // ========================================

  describe('createWeeklyRecord', () => {
    const dto = {
      user_id: 'uuid-user-1',
      week: 5,
      year: 2026,
      attendance: 10,
      punctuality: 5,
    };

    it('should create a weekly record', async () => {
      const mockUnit = {
        unit_id: 1,
        unit_members: [{ user_id: dto.user_id, active: true }],
      };
      const mockRecord = { record_id: 1, ...dto, points: 0, active: true };

      mockPrismaService.units.findUnique.mockResolvedValue(mockUnit);
      mockPrismaService.weekly_records.findUnique
        .mockResolvedValueOnce(null) // conflict check
        .mockResolvedValueOnce(mockRecord); // final fetch inside transaction
      mockPrismaService.weekly_records.create.mockResolvedValue(mockRecord);

      const result = await service.createWeeklyRecord(1, dto);

      expect(result).toBeDefined();
    });

    it('should throw BadRequestException when user is not a member of the unit', async () => {
      const mockUnit = { unit_id: 1, unit_members: [] };
      mockPrismaService.units.findUnique.mockResolvedValue(mockUnit);

      await expect(service.createWeeklyRecord(1, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ConflictException when record for that week already exists', async () => {
      const mockUnit = {
        unit_id: 1,
        unit_members: [{ user_id: dto.user_id, active: true }],
      };
      const existingRecord = { record_id: 1, ...dto };

      mockPrismaService.units.findUnique.mockResolvedValue(mockUnit);
      mockPrismaService.weekly_records.findUnique.mockResolvedValue(
        existingRecord,
      );

      await expect(service.createWeeklyRecord(1, dto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ========================================
  // updateWeeklyRecord
  // ========================================

  describe('updateWeeklyRecord', () => {
    it('should update a weekly record', async () => {
      const mockUnit = { unit_id: 1, unit_members: [] };
      const mockRecord = {
        record_id: 10,
        user_id: 'uuid-user-1',
        week: 5,
        attendance: 10,
        punctuality: 5,
        points: 15,
      };
      const updated = { ...mockRecord, points: 20 };

      mockPrismaService.units.findUnique.mockResolvedValue(mockUnit);
      mockPrismaService.weekly_records.findFirst.mockResolvedValue(mockRecord);
      mockPrismaService.weekly_records.update.mockResolvedValue(updated);

      const result = await service.updateWeeklyRecord(1, 10, { attendance: 1 });

      expect(result).toBeDefined();
    });

    it('should throw NotFoundException when record does not exist', async () => {
      const mockUnit = { unit_id: 1, unit_members: [] };
      mockPrismaService.units.findUnique.mockResolvedValue(mockUnit);
      mockPrismaService.weekly_records.findFirst.mockResolvedValue(null);

      await expect(
        service.updateWeeklyRecord(1, 999, { attendance: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when unit does not exist', async () => {
      mockPrismaService.units.findUnique.mockResolvedValue(null);

      await expect(service.updateWeeklyRecord(999, 10, {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
