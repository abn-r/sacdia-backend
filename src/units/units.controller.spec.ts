import { Test, TestingModule } from '@nestjs/testing';
import { UnitsController } from './units.controller';
import { UnitsService } from './units.service';
import { JwtAuthGuard } from '../common/guards';
import { PermissionsGuard } from '../common/guards';

describe('UnitsController', () => {
  let controller: UnitsController;

  const mockUnitsService = {
    findByClub: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    addMember: jest.fn(),
    removeMember: jest.fn(),
    findWeeklyRecords: jest.fn(),
    createWeeklyRecord: jest.fn(),
    updateWeeklyRecord: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UnitsController],
      providers: [{ provide: UnitsService, useValue: mockUnitsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UnitsController>(UnitsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ========================================
  // findByClub
  // ========================================

  describe('findByClub', () => {
    it('should call service.findByClub with clubId', async () => {
      const mockUnits = [{ unit_id: 1, name: 'Falange Norte' }];
      mockUnitsService.findByClub.mockResolvedValue(mockUnits);

      const result = await controller.findByClub(1);

      expect(mockUnitsService.findByClub).toHaveBeenCalledWith(1);
      expect(result).toEqual(mockUnits);
    });
  });

  // ========================================
  // findOne
  // ========================================

  describe('findOne', () => {
    it('should call service.findOne with unitId', async () => {
      const mockUnit = { unit_id: 5, name: 'Falange Sur' };
      mockUnitsService.findOne.mockResolvedValue(mockUnit);

      const result = await controller.findOne(1, 5);

      expect(mockUnitsService.findOne).toHaveBeenCalledWith(5);
      expect(result).toEqual(mockUnit);
    });
  });

  // ========================================
  // create
  // ========================================

  describe('create', () => {
    it('should call service.create with clubId and dto', async () => {
      const dto = {
        name: 'Falange Norte',
        captain_id: 'uuid-captain',
        secretary_id: 'uuid-secretary',
        advisor_id: 'uuid-advisor',
        club_type_id: 2,
      };
      const mockUnit = { unit_id: 1, ...dto };
      mockUnitsService.create.mockResolvedValue(mockUnit);

      const result = await controller.create(1, dto);

      expect(mockUnitsService.create).toHaveBeenCalledWith(1, dto);
      expect(result).toEqual(mockUnit);
    });
  });

  // ========================================
  // update
  // ========================================

  describe('update', () => {
    it('should call service.update with unitId and dto', async () => {
      const dto = { name: 'Falange Oeste' };
      const mockUnit = { unit_id: 5, name: 'Falange Oeste' };
      mockUnitsService.update.mockResolvedValue(mockUnit);

      const result = await controller.update(1, 5, dto);

      expect(mockUnitsService.update).toHaveBeenCalledWith(5, dto);
      expect(result).toEqual(mockUnit);
    });
  });

  // ========================================
  // remove
  // ========================================

  describe('remove', () => {
    it('should call service.remove with unitId', async () => {
      mockUnitsService.remove.mockResolvedValue({ unit_id: 5, active: false });

      const result = await controller.remove(1, 5);

      expect(mockUnitsService.remove).toHaveBeenCalledWith(5);
      expect(result).toEqual(expect.objectContaining({ active: false }));
    });
  });

  // ========================================
  // addMember
  // ========================================

  describe('addMember', () => {
    it('should call service.addMember with unitId and dto', async () => {
      const dto = { user_id: 'uuid-user-1' };
      const mockMember = {
        unit_member_id: 1,
        unit_id: 5,
        user_id: dto.user_id,
      };
      mockUnitsService.addMember.mockResolvedValue(mockMember);

      const result = await controller.addMember(1, 5, dto);

      expect(mockUnitsService.addMember).toHaveBeenCalledWith(5, dto);
      expect(result).toEqual(mockMember);
    });
  });

  // ========================================
  // removeMember
  // ========================================

  describe('removeMember', () => {
    it('should call service.removeMember with unitId and memberId', async () => {
      mockUnitsService.removeMember.mockResolvedValue({
        unit_member_id: 10,
        active: false,
      });

      const result = await controller.removeMember(1, 5, 10);

      expect(mockUnitsService.removeMember).toHaveBeenCalledWith(5, 10);
      expect(result).toEqual(expect.objectContaining({ active: false }));
    });
  });

  // ========================================
  // findWeeklyRecords
  // ========================================

  describe('findWeeklyRecords', () => {
    it('should call service.findWeeklyRecords with unitId', async () => {
      const mockRecords = [{ record_id: 1, week: 5, points: 15 }];
      mockUnitsService.findWeeklyRecords.mockResolvedValue(mockRecords);

      const result = await controller.findWeeklyRecords(1, 5);

      expect(mockUnitsService.findWeeklyRecords).toHaveBeenCalledWith(5);
      expect(result).toEqual(mockRecords);
    });
  });

  // ========================================
  // createWeeklyRecord
  // ========================================

  describe('createWeeklyRecord', () => {
    it('should call service.createWeeklyRecord with unitId and dto', async () => {
      const dto = {
        user_id: 'uuid-user-1',
        week: 5,
        attendance: 10,
        punctuality: 5,
        points: 15,
      };
      const mockRecord = { record_id: 1, ...dto };
      mockUnitsService.createWeeklyRecord.mockResolvedValue(mockRecord);

      const mockReq = { user: { sub: 'uuid-user-1' } };
      const result = await controller.createWeeklyRecord(
        1,
        5,
        dto as any,
        mockReq as any,
      );

      expect(mockUnitsService.createWeeklyRecord).toHaveBeenCalledWith(
        5,
        dto,
        'uuid-user-1',
      );
      expect(result).toEqual(mockRecord);
    });
  });

  // ========================================
  // updateWeeklyRecord
  // ========================================

  describe('updateWeeklyRecord', () => {
    it('should call service.updateWeeklyRecord with unitId, recordId and dto', async () => {
      const dto = { attendance: 1 };
      const mockRecord = { record_id: 10, points: 20 };
      mockUnitsService.updateWeeklyRecord.mockResolvedValue(mockRecord);

      const result = await controller.updateWeeklyRecord(1, 5, 10, dto);

      expect(mockUnitsService.updateWeeklyRecord).toHaveBeenCalledWith(
        5,
        10,
        dto,
      );
      expect(result).toEqual(mockRecord);
    });
  });
});
