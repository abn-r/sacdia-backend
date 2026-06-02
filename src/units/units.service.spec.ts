import { Test, TestingModule } from '@nestjs/testing';
import { UnitsService } from './units.service';
import { PrismaService } from '../prisma/prisma.service';
import { ScoringCategoriesService } from '../scoring-categories/scoring-categories.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ErrorCode } from '../common/errors/error-codes';

describe('UnitsService', () => {
  let service: UnitsService;

  const mockPrismaService = {
    clubs: {
      findUnique: jest.fn(),
    },
    club_sections: {
      findUnique: jest.fn(),
    },
    club_role_assignments: {
      findFirst: jest.fn(),
    },
    units: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
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
        {
          provide: ScoringCategoriesService,
          useValue: mockScoringCategoriesService,
        },
        {
          provide: NotificationsService,
          useValue: {
            sendSilentToSection: jest.fn().mockResolvedValue(undefined),
          },
        },
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

      await expect(service.findByClub(999)).rejects.toMatchObject({
        code: ErrorCode.UNIT_CLUB_NOT_FOUND,
      });
    });

    it('should return empty array without querying all units when club has no sections', async () => {
      const mockClub = { club_id: 1, club_sections: [] };
      mockPrismaService.clubs.findUnique.mockResolvedValue(mockClub);

      const result = await service.findByClub(1);

      expect(result).toEqual([]);
      expect(mockPrismaService.units.findMany).not.toHaveBeenCalled();
    });

    it('should only use active club sections to list units', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue({
        club_id: 1,
        club_sections: [{ club_section_id: 10 }],
      });
      mockPrismaService.units.findMany.mockResolvedValue([]);

      await service.findByClub(1);

      expect(mockPrismaService.clubs.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            club_sections: {
              where: { active: true },
              select: { club_section_id: true },
            },
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
      mockPrismaService.units.findFirst.mockResolvedValue(mockUnit);

      const result = await service.findOne(1);

      expect(result).toEqual(mockUnit);
    });

    it('should scope the unit lookup to the requested club when clubId is provided', async () => {
      const mockUnit = { unit_id: 5, name: 'Falange Sur', unit_members: [] };
      mockPrismaService.units.findFirst.mockResolvedValue(mockUnit);

      const result = await service.findOne(5, 1);

      expect(result).toEqual(mockUnit);
      expect(mockPrismaService.units.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            unit_id: 5,
            active: true,
            club_sections: { main_club_id: 1 },
          }),
        }),
      );
    });

    it('should throw NotFoundException when unit does not exist', async () => {
      mockPrismaService.units.findFirst.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toMatchObject({
        code: ErrorCode.UNIT_NOT_FOUND,
      });
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
        club_type_id: 2,
        active: true,
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

      await expect(service.create(999, createDto)).rejects.toMatchObject({
        code: ErrorCode.UNIT_CLUB_NOT_FOUND,
      });
    });

    it('should throw BadRequestException when section does not exist', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue({ club_id: 1 });
      mockPrismaService.club_sections.findUnique.mockResolvedValue(null);

      await expect(service.create(1, createDto)).rejects.toMatchObject({
        code: ErrorCode.UNIT_SECTION_NOT_FOUND,
      });
    });

    it('should throw BadRequestException when section belongs to a different club', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue({ club_id: 1 });
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        main_club_id: 99,
        club_type_id: 2,
        active: true,
      });

      await expect(service.create(1, createDto)).rejects.toMatchObject({
        code: ErrorCode.UNIT_SECTION_WRONG_CLUB,
      });
    });

    it('should reject creating a unit when club_type_id does not match section type', async () => {
      mockPrismaService.clubs.findUnique.mockResolvedValue({ club_id: 1 });
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        main_club_id: 1,
        club_type_id: 1,
        active: true,
      });

      await expect(service.create(1, createDto)).rejects.toMatchObject({
        code: 'UNIT_SECTION_TYPE_MISMATCH',
      });
      expect(mockPrismaService.units.create).not.toHaveBeenCalled();
    });

    it('should reject creating a unit without club_section_id', async () => {
      const dtoWithoutSection = { ...createDto };
      delete (dtoWithoutSection as any).club_section_id;

      mockPrismaService.clubs.findUnique.mockResolvedValue({ club_id: 1 });

      await expect(service.create(1, dtoWithoutSection)).rejects.toMatchObject({
        code: ErrorCode.UNIT_SECTION_NOT_FOUND,
      });
      expect(mockPrismaService.club_sections.findUnique).not.toHaveBeenCalled();
      expect(mockPrismaService.units.create).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // update
  // ========================================

  describe('update', () => {
    it('should update allowed fields', async () => {
      const existing = { unit_id: 1, name: 'Falange Norte', unit_members: [] };
      const updated = { unit_id: 1, name: 'Falange Sur', unit_members: [] };

      mockPrismaService.units.findFirst.mockResolvedValue(existing);
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
      mockPrismaService.units.findFirst.mockResolvedValue(null);

      await expect(service.update(999, { name: 'X' })).rejects.toMatchObject({
        code: ErrorCode.UNIT_NOT_FOUND,
      });
    });

    it('should reject updating club_type_id when it does not match the unit section type', async () => {
      mockPrismaService.units.findFirst.mockResolvedValue({
        unit_id: 1,
        club_section_id: 10,
        club_type_id: 2,
        club_sections: { main_club_id: 1 },
        unit_members: [],
      });
      mockPrismaService.club_sections.findUnique.mockResolvedValue({
        main_club_id: 1,
        club_type_id: 2,
        active: true,
      });

      await expect(service.update(1, { club_type_id: 1 }, 1)).rejects.toMatchObject(
        {
          code: 'UNIT_SECTION_TYPE_MISMATCH',
        },
      );
      expect(mockPrismaService.units.update).not.toHaveBeenCalled();
    });
  });

  // ========================================
  // remove
  // ========================================

  describe('remove', () => {
    it('should soft-delete the unit', async () => {
      const existing = { unit_id: 1, name: 'Falange Norte', unit_members: [] };

      mockPrismaService.units.findFirst.mockResolvedValue(existing);
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
      mockPrismaService.units.findFirst.mockResolvedValue(null);

      await expect(service.remove(999)).rejects.toMatchObject({
        code: ErrorCode.UNIT_NOT_FOUND,
      });
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

      mockPrismaService.units.findFirst.mockResolvedValue(mockUnit);
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

      mockPrismaService.units.findFirst.mockResolvedValue(mockUnit);
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: dto.user_id,
      });
      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'assignment-1',
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

      mockPrismaService.units.findFirst.mockResolvedValue(mockUnit);
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: dto.user_id,
      });
      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue({
        assignment_id: 'assignment-1',
      });
      // First findFirst: cross-section conflict check (null = no conflict in section 10)
      // Second findFirst: finds the active membership in THIS unit → triggers ConflictException
      mockPrismaService.unit_members.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingActive);

      await expect(service.addMember(1, dto)).rejects.toMatchObject({
        code: ErrorCode.UNIT_MEMBER_ALREADY_IN_UNIT,
      });
    });

    it('should reject adding a user that does not belong to the unit section', async () => {
      mockPrismaService.units.findFirst.mockResolvedValue({
        unit_id: 1,
        club_section_id: 10,
        unit_members: [],
      });
      mockPrismaService.users.findUnique.mockResolvedValue({
        user_id: dto.user_id,
      });
      mockPrismaService.club_role_assignments.findFirst.mockResolvedValue(null);

      await expect(service.addMember(1, dto)).rejects.toMatchObject({
        code: 'UNIT_USER_NOT_IN_SECTION',
      });
      expect(mockPrismaService.unit_members.create).not.toHaveBeenCalled();
      expect(mockPrismaService.unit_members.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when unit does not exist', async () => {
      mockPrismaService.units.findFirst.mockResolvedValue(null);

      await expect(service.addMember(999, dto)).rejects.toMatchObject({
        code: ErrorCode.UNIT_NOT_FOUND,
      });
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockPrismaService.units.findFirst.mockResolvedValue({
        unit_id: 1,
        unit_members: [],
      });
      mockPrismaService.users.findUnique.mockResolvedValue(null);

      await expect(service.addMember(1, dto)).rejects.toMatchObject({
        code: ErrorCode.UNIT_USER_NOT_FOUND,
      });
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

      mockPrismaService.units.findFirst.mockResolvedValue(mockUnit);
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
      mockPrismaService.units.findFirst.mockResolvedValue({
        unit_id: 1,
        unit_members: [],
      });
      mockPrismaService.unit_members.findFirst.mockResolvedValue(null);

      await expect(service.removeMember(1, 999)).rejects.toMatchObject({
        code: ErrorCode.UNIT_MEMBER_NOT_FOUND,
      });
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

      mockPrismaService.units.findFirst.mockResolvedValue(mockUnit);
      mockPrismaService.weekly_records.findMany.mockResolvedValue(mockRecords);

      const result = await service.findWeeklyRecords(1);

      // transformWeeklyRecord strips weekly_record_scores and adds scores: []
      expect(result).toEqual([
        {
          record_id: 1,
          user_id: 'uuid-user-1',
          week: 1,
          points: 10,
          scores: [],
        },
      ]);
    });

    it('should return empty array when unit has no active members', async () => {
      const mockUnit = { unit_id: 1, unit_members: [] };
      mockPrismaService.units.findFirst.mockResolvedValue(mockUnit);

      const result = await service.findWeeklyRecords(1);

      expect(result).toEqual([]);
      expect(mockPrismaService.weekly_records.findMany).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when unit does not exist', async () => {
      mockPrismaService.units.findFirst.mockResolvedValue(null);

      await expect(service.findWeeklyRecords(999)).rejects.toMatchObject({
        code: ErrorCode.UNIT_NOT_FOUND,
      });
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

      mockPrismaService.units.findFirst.mockResolvedValue(mockUnit);
      mockPrismaService.weekly_records.findUnique
        .mockResolvedValueOnce(null) // conflict check
        .mockResolvedValueOnce(mockRecord); // final fetch inside transaction
      mockPrismaService.weekly_records.create.mockResolvedValue(mockRecord);

      const result = await service.createWeeklyRecord(1, dto, dto.user_id);

      expect(result).toBeDefined();
    });

    it('should throw BadRequestException when user is not a member of the unit', async () => {
      const mockUnit = { unit_id: 1, unit_members: [] };
      mockPrismaService.units.findFirst.mockResolvedValue(mockUnit);

      await expect(
        service.createWeeklyRecord(1, dto, dto.user_id),
      ).rejects.toMatchObject({ code: ErrorCode.UNIT_MEMBER_NOT_ACTIVE });
    });

    it('should throw ConflictException when record for that week already exists', async () => {
      const mockUnit = {
        unit_id: 1,
        unit_members: [{ user_id: dto.user_id, active: true }],
      };
      const existingRecord = { record_id: 1, ...dto };

      mockPrismaService.units.findFirst.mockResolvedValue(mockUnit);
      mockPrismaService.weekly_records.findUnique.mockResolvedValue(
        existingRecord,
      );

      await expect(
        service.createWeeklyRecord(1, dto, dto.user_id),
      ).rejects.toMatchObject({ code: ErrorCode.UNIT_WEEKLY_RECORD_DUPLICATE });
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

      mockPrismaService.units.findFirst.mockResolvedValue(mockUnit);
      mockPrismaService.weekly_records.findFirst.mockResolvedValue(mockRecord);
      mockPrismaService.unit_members.findFirst.mockResolvedValue({
        unit_member_id: 1,
        unit_id: 1,
        user_id: 'uuid-user-1',
        active: true,
      });
      mockPrismaService.weekly_records.update.mockResolvedValue({
        ...updated,
        weekly_record_scores: [],
      });

      const result = await service.updateWeeklyRecord(1, 10, { attendance: 1 });

      expect(result).toBeDefined();
    });

    it('should throw NotFoundException when record does not exist', async () => {
      const mockUnit = { unit_id: 1, unit_members: [] };
      mockPrismaService.units.findFirst.mockResolvedValue(mockUnit);
      mockPrismaService.weekly_records.findFirst.mockResolvedValue(null);

      await expect(
        service.updateWeeklyRecord(1, 999, { attendance: 1 }),
      ).rejects.toMatchObject({ code: ErrorCode.UNIT_WEEKLY_RECORD_NOT_FOUND });
    });

    it('should throw NotFoundException when unit does not exist', async () => {
      mockPrismaService.units.findFirst.mockResolvedValue(null);

      await expect(
        service.updateWeeklyRecord(999, 10, {}),
      ).rejects.toMatchObject({ code: ErrorCode.UNIT_NOT_FOUND });
    });
  });
});
