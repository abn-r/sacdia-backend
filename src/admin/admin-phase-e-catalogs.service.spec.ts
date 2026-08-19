import { BadRequestException } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { TranslationService } from '../common/services/translation.service';
import { CatalogCacheService } from '../catalogs/catalog-cache.service';
import { AdminPhaseECatalogsService } from './admin-phase-e-catalogs.service';
import { MasterHonorRequirementGroupDto } from './dto/phase-e-catalogs.dto';
import { CreateMasterHonorDto } from './dto/phase-e-catalogs.dto';
import {
  MASTER_HONOR_RECALCULATION_JOB_OPTIONS,
  MASTER_HONORS_QUEUE,
} from '../honors/master-honors.constants';
import {
  master_honor_applicability_scope_enum,
  master_honor_requirement_group_type_enum,
} from '@prisma/client';
import { ErrorCode } from '../common/errors/error-codes';

const ACTOR_ID = 'actor-uuid';

const makePrismaMock = () => ({
  classes: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  class_honors: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  class_prerequisites: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  master_honors: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  master_honor_divisions: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  master_honor_requirement_groups: {
    deleteMany: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  master_honor_requirement_options: {
    deleteMany: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  divisions: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  honors_categories: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  honors: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
});

const makeTranslationMock = () => ({
  validateTranslations: jest.fn(),
  upsertTranslations: jest.fn().mockResolvedValue(undefined),
});

describe('MasterHonorRequirementGroupDto', () => {
  it('allows CATEGORY_COUNT groups to omit options', async () => {
    const dto = plainToInstance(MasterHonorRequirementGroupDto, {
      group_type: master_honor_requirement_group_type_enum.CATEGORY_COUNT,
      minimum_required: 1,
      honors_category_id: 3,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('validates provided nested options', async () => {
    const dto = plainToInstance(MasterHonorRequirementGroupDto, {
      group_type: master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS,
      minimum_required: 1,
      options: [{ label: 'Opción sin honores', honor_ids: [] }],
    });

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'options',
        }),
      ]),
    );
  });
});

describe('CreateMasterHonorDto', () => {
  it('accepts positive division_ids', async () => {
    const dto = plainToInstance(CreateMasterHonorDto, {
      name: 'Maestría de Prueba',
      applicability_scope: master_honor_applicability_scope_enum.SELECTED_DIVISIONS,
      division_ids: [1, 2],
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects zero or negative division_ids', async () => {
    const dto = plainToInstance(CreateMasterHonorDto, {
      name: 'Maestría de Prueba',
      applicability_scope: master_honor_applicability_scope_enum.SELECTED_DIVISIONS,
      division_ids: [0, -1],
    });

    const errors = await validate(dto);

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          property: 'division_ids',
        }),
      ]),
    );
  });
});

describe('AdminPhaseECatalogsService', () => {
  let service: AdminPhaseECatalogsService;
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let translationMock: ReturnType<typeof makeTranslationMock>;
  let txMock: ReturnType<typeof makePrismaMock>;
  let masterHonorsQueueMock: { add: jest.Mock };

  const buildService = async (hasQueue: boolean) => {
    const providers = [
      AdminPhaseECatalogsService,
      { provide: PrismaService, useValue: prismaMock },
      { provide: TranslationService, useValue: translationMock },
      {
        provide: CatalogCacheService,
        useValue: {
          bumpEpoch: jest.fn().mockResolvedValue(undefined),
          invalidate: jest.fn().mockResolvedValue(undefined),
        },
      },
    ];

    if (hasQueue) {
      providers.push({
        provide: getQueueToken(MASTER_HONORS_QUEUE),
        useValue: masterHonorsQueueMock,
      });
    }

    const module: TestingModule = await Test.createTestingModule({
      providers,
    }).compile();

    return module.get<AdminPhaseECatalogsService>(
      AdminPhaseECatalogsService,
    );
  };

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    translationMock = makeTranslationMock();
    txMock = makePrismaMock();
    masterHonorsQueueMock = { add: jest.fn() };

    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock),
    );

    service = await buildService(true);
  });

  describe('classes legacy duration and availability', () => {
    it('persists availability and duration fields when creating a class', async () => {
      prismaMock.classes.findFirst.mockResolvedValue(null);
      txMock.classes.create.mockResolvedValue({ class_id: 7, name: 'Amigo' });

      await service.createClass(
        {
          name: ' Amigo ',
          club_type_id: 1,
          available_from_year_id: 2025,
          available_until_year_id: null,
          min_duration_years: 1,
          max_duration_years: 2,
        } as any,
        ACTOR_ID,
      );

      expect(txMock.classes.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          available_from_year_id: 2025,
          available_until_year_id: null,
          min_duration_years: 1,
          max_duration_years: 2,
        }),
      });
    });

    it('defaults missing availability to null and duration to one year when creating a class', async () => {
      prismaMock.classes.findFirst.mockResolvedValue(null);
      txMock.classes.create.mockResolvedValue({
        class_id: 8,
        name: 'Compañero',
      });

      await service.createClass(
        {
          name: 'Compañero',
          club_type_id: 1,
        } as any,
        ACTOR_ID,
      );

      expect(txMock.classes.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          available_from_year_id: null,
          available_until_year_id: null,
          min_duration_years: 1,
          max_duration_years: 1,
        }),
      });
    });

    it('persists present availability and duration fields when updating a class, including null clears', async () => {
      prismaMock.classes.findUnique.mockResolvedValue({
        class_id: 7,
        name: 'Amigo',
        min_duration_years: 1,
        max_duration_years: 1,
      });
      txMock.classes.update.mockResolvedValue({ class_id: 7, name: 'Amigo' });

      await service.updateClass(
        7,
        {
          available_from_year_id: null,
          available_until_year_id: 2026,
          min_duration_years: 2,
          max_duration_years: 3,
        } as any,
        ACTOR_ID,
      );

      expect(txMock.classes.update).toHaveBeenCalledWith({
        where: { class_id: 7 },
        data: expect.objectContaining({
          available_from_year_id: null,
          available_until_year_id: 2026,
          min_duration_years: 2,
          max_duration_years: 3,
        }),
      });
    });

    it('does not overwrite availability and duration fields when omitted on update', async () => {
      prismaMock.classes.findUnique.mockResolvedValue({
        class_id: 7,
        name: 'Amigo',
        min_duration_years: 1,
        max_duration_years: 2,
      });
      txMock.classes.update.mockResolvedValue({ class_id: 7, name: 'Amigo' });

      await service.updateClass(7, { active: false }, ACTOR_ID);

      const updateArg = txMock.classes.update.mock.calls[0][0];
      expect(updateArg.data).not.toHaveProperty('available_from_year_id');
      expect(updateArg.data).not.toHaveProperty('available_until_year_id');
      expect(updateArg.data).not.toHaveProperty('min_duration_years');
      expect(updateArg.data).not.toHaveProperty('max_duration_years');
    });

    it('rejects duration ranges where max is lower than min', async () => {
      prismaMock.classes.findFirst.mockResolvedValue(null);

      await expect(
        service.createClass(
          {
            name: 'Amigo',
            club_type_id: 1,
            min_duration_years: 3,
            max_duration_years: 2,
          } as any,
          ACTOR_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('master honor configurable requirements', () => {
    it('creates a master honor with philosophy, notes and applicability scope', async () => {
      prismaMock.master_honors.findFirst.mockResolvedValue(null);
      txMock.master_honors.create.mockResolvedValue({
        master_honor_id: 11,
        name: 'Maestro',
        applicability_scope:
          master_honor_applicability_scope_enum.ALL,
      });
      txMock.master_honor_divisions.deleteMany.mockResolvedValue({ count: 0 });
      txMock.master_honor_requirement_groups.create.mockResolvedValue({ group_id: 1 });

      await service.createMasterHonor(
        {
          name: 'Maestro',
          philosophy: 'Filosofía de servicio',
          notes: 'Notas internas',
          applicability_scope:
            master_honor_applicability_scope_enum.ALL,
        } as any,
        ACTOR_ID,
      );

      expect(txMock.master_honors.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Maestro',
          philosophy: 'Filosofía de servicio',
          notes: 'Notas internas',
          applicability_scope: master_honor_applicability_scope_enum.ALL,
        }),
      });
    });

    it('updates a master honor with philosophy, notes and applicability scope', async () => {
      prismaMock.master_honors.findUnique.mockResolvedValue({
        master_honor_id: 9,
        name: 'Maestro',
        applicability_scope: master_honor_applicability_scope_enum.ALL,
      });
      txMock.master_honors.update.mockResolvedValue({
        master_honor_id: 9,
        name: 'Maestro',
      });
      txMock.master_honor_divisions.deleteMany.mockResolvedValue({ count: 0 });
      txMock.master_honor_divisions.createMany.mockResolvedValue({ count: 0 });

      await service.updateMasterHonor(
        9,
        {
          philosophy: 'Filosofía actualizada',
          notes: 'Notas actualizadas',
          applicability_scope:
            master_honor_applicability_scope_enum.ALL,
        } as any,
        ACTOR_ID,
      );

      expect(txMock.master_honors.update).toHaveBeenCalledWith({
        where: { master_honor_id: 9 },
        data: expect.objectContaining({
          philosophy: 'Filosofía actualizada',
          notes: 'Notas actualizadas',
          applicability_scope: master_honor_applicability_scope_enum.ALL,
        }),
      });
    });

    it('updates requirement groups without resending division_ids for an existing selected-division master honor', async () => {
      prismaMock.master_honors.findUnique.mockResolvedValue({
        master_honor_id: 9,
        name: 'Maestro',
        applicability_scope:
          master_honor_applicability_scope_enum.SELECTED_DIVISIONS,
      });
      prismaMock.honors.findMany.mockResolvedValue([{ honor_id: 1 }]);
      txMock.master_honors.update.mockResolvedValue({
        master_honor_id: 9,
        name: 'Maestro',
      });
      txMock.master_honor_requirement_options.deleteMany.mockResolvedValue({
        count: 0,
      });
      txMock.master_honor_requirement_groups.deleteMany.mockResolvedValue({
        count: 0,
      });
      txMock.master_honor_requirement_groups.create.mockResolvedValue({
        group_id: 1,
      });

      await service.updateMasterHonor(
        9,
        {
          requirement_groups: [
            {
              group_type:
                master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS,
              minimum_required: 1,
              options: [{ label: 'Opción', honor_ids: [1] }],
            },
          ],
        } as any,
        ACTOR_ID,
      );

      expect(txMock.master_honor_divisions.deleteMany).not.toHaveBeenCalled();
      expect(txMock.master_honor_requirement_groups.create).toHaveBeenCalled();
    });

    it('does not clear requirement groups when a partial update omits requirement_groups', async () => {
      prismaMock.master_honors.findUnique.mockResolvedValue({
        master_honor_id: 9,
        name: 'Maestro',
        applicability_scope: master_honor_applicability_scope_enum.ALL,
      });
      txMock.master_honors.update.mockResolvedValue({
        master_honor_id: 9,
        name: 'Maestro',
      });

      await service.updateMasterHonor(
        9,
        {
          notes: 'Solo actualizar notas',
        } as any,
        ACTOR_ID,
      );

      expect(
        txMock.master_honor_requirement_groups.deleteMany,
      ).not.toHaveBeenCalled();
      expect(txMock.master_honor_requirement_groups.create).not.toHaveBeenCalled();
    });

    it('enqueues a recalculation job and returns queued=true when queue is available', async () => {
      prismaMock.master_honors.findUnique.mockResolvedValue({
        master_honor_id: 9,
        name: 'Maestro',
      });
      masterHonorsQueueMock.add.mockResolvedValue({ id: 'job-1' } as any);

      const result = await service.recalculateMasterHonor(9, ACTOR_ID);

      expect(result).toEqual(
        expect.objectContaining({
          queued: true,
        }),
      );

      expect(masterHonorsQueueMock.add).toHaveBeenCalledWith(
        'recalculate-master-honor',
        {
          kind: 'master-honor',
          masterHonorId: 9,
        },
        MASTER_HONOR_RECALCULATION_JOB_OPTIONS,
      );
    });

    it('returns queued=false when recalculation queue is not configured', async () => {
      prismaMock.master_honors.findUnique.mockResolvedValue({
        master_honor_id: 9,
        name: 'Maestro',
      });

      service = await buildService(false);

      const result = await service.recalculateMasterHonor(9, ACTOR_ID);

      expect(result).toEqual(
        expect.objectContaining({
          queued: false,
        }),
      );
    });

    it('requires at least one division_id when applicability_scope is SELECTED_DIVISIONS', async () => {
      prismaMock.master_honors.findFirst.mockResolvedValue(null);

      await expect(
        service.createMasterHonor(
          {
            name: 'Maestro',
            applicability_scope:
              master_honor_applicability_scope_enum.SELECTED_DIVISIONS,
            division_ids: [],
          } as any,
          ACTOR_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('clears selected divisions when applicability_scope is ALL', async () => {
      prismaMock.master_honors.findFirst.mockResolvedValue(null);
      txMock.master_honors.create.mockResolvedValue({
        master_honor_id: 12,
        name: 'Maestro',
        applicability_scope: master_honor_applicability_scope_enum.ALL,
      });
      txMock.master_honor_divisions.deleteMany.mockResolvedValue({ count: 0 });
      txMock.master_honor_divisions.createMany.mockResolvedValue({ count: 0 });

      await service.createMasterHonor(
        {
          name: 'Maestro',
          applicability_scope: master_honor_applicability_scope_enum.ALL,
          division_ids: [1, 2],
        } as any,
        ACTOR_ID,
      );

      expect(txMock.master_honor_divisions.createMany).not.toHaveBeenCalled();
    });

    it('validates minimum_required >= 1 for rule groups', async () => {
      prismaMock.master_honors.findFirst.mockResolvedValue(null);

      await expect(
        service.createMasterHonor(
          {
            name: 'Maestro',
            requirement_groups: [
              {
                group_type:
                  master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS,
                minimum_required: 0,
                options: [{ label: 'O', honor_ids: [1] }],
              },
            ],
          } as any,
          ACTOR_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires explicit groups to have options', async () => {
      prismaMock.master_honors.findFirst.mockResolvedValue(null);

      await expect(
        service.createMasterHonor(
          {
            name: 'Maestro',
            requirement_groups: [
              {
                group_type:
                  master_honor_requirement_group_type_enum.EXPLICIT_OPTIONS,
                minimum_required: 1,
                options: [],
              },
            ],
          } as any,
          ACTOR_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects category groups without category id', async () => {
      prismaMock.master_honors.findFirst.mockResolvedValue(null);

      await expect(
        service.createMasterHonor(
          {
            name: 'Maestro',
            requirement_groups: [
              {
                group_type:
                  master_honor_requirement_group_type_enum.CATEGORY_COUNT,
                minimum_required: 1,
                options: [],
              },
            ],
          } as any,
          ACTOR_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires category groups to set category and not include options', async () => {
      prismaMock.master_honors.findFirst.mockResolvedValue(null);

      await expect(
        service.createMasterHonor(
          {
            name: 'Maestro',
            requirement_groups: [
              {
                group_type:
                  master_honor_requirement_group_type_enum.CATEGORY_COUNT,
                minimum_required: 1,
                options: [{ label: 'No permitido', honor_ids: [1] }],
              },
            ],
          } as any,
          ACTOR_ID,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('class honors', () => {
    it('creates a class-honor relation', async () => {
      prismaMock.classes.findUnique.mockResolvedValue({ class_id: 7 });
      prismaMock.honors.findUnique.mockResolvedValue({ honor_id: 50 });
      prismaMock.class_honors.findFirst.mockResolvedValue(null);
      prismaMock.class_honors.create.mockResolvedValue({
        class_honor_id: 1,
        class_id: 7,
        honor_id: 50,
        relation_type: 'RECOMMENDED',
        active: true,
        honor: { honor_id: 50, name: 'Nudos' },
      });

      const result = await service.createClassHonor(
        7,
        { honor_id: 50, relation_type: 'RECOMMENDED' as any },
        ACTOR_ID,
      );

      expect(result.class_honor_id).toBe(1);
      expect(prismaMock.class_honors.create).toHaveBeenCalled();
    });

    it('throws on duplicate active relation', async () => {
      prismaMock.classes.findUnique.mockResolvedValue({ class_id: 7 });
      prismaMock.honors.findUnique.mockResolvedValue({ honor_id: 50 });
      prismaMock.class_honors.findFirst.mockResolvedValue({
        class_honor_id: 1,
      });

      await expect(
        service.createClassHonor(
          7,
          { honor_id: 50, relation_type: 'RECOMMENDED' as any },
          ACTOR_ID,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.ADMIN_CLASS_HONOR_DUPLICATE,
      });
    });

    it('soft-deletes a class-honor relation', async () => {
      prismaMock.class_honors.findFirst.mockResolvedValue({
        class_honor_id: 11,
        class_id: 7,
      });
      prismaMock.class_honors.update.mockResolvedValue({
        class_honor_id: 11,
        active: false,
      });

      const result = await service.deleteClassHonor(7, 11, ACTOR_ID);
      expect(result.active).toBe(false);
    });

    it('throws when deleting missing class-honor', async () => {
      prismaMock.class_honors.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteClassHonor(7, 999, ACTOR_ID),
      ).rejects.toMatchObject({
        code: ErrorCode.ADMIN_CLASS_HONOR_NOT_FOUND,
      });
    });
  });

  describe('class prerequisites', () => {
    it('creates a class prerequisite', async () => {
      prismaMock.classes.findUnique
        .mockResolvedValueOnce({ class_id: 10 })
        .mockResolvedValueOnce({ class_id: 5 });
      prismaMock.class_prerequisites.findMany.mockResolvedValue([]);
      prismaMock.class_prerequisites.findFirst.mockResolvedValue(null);
      prismaMock.class_prerequisites.create.mockResolvedValue({
        class_prerequisite_id: 1,
        class_id: 10,
        prerequisite_class_id: 5,
        active: true,
        prerequisite: { class_id: 5, name: 'Amigo', active: true },
      });

      const result = await service.createClassPrerequisite(
        10,
        { prerequisite_class_id: 5 },
        ACTOR_ID,
      );

      expect(result.class_prerequisite_id).toBe(1);
    });

    it('throws on duplicate active prerequisite', async () => {
      prismaMock.classes.findUnique
        .mockResolvedValueOnce({ class_id: 10 })
        .mockResolvedValueOnce({ class_id: 5 });
      prismaMock.class_prerequisites.findMany.mockResolvedValue([]);
      prismaMock.class_prerequisites.findFirst.mockResolvedValue({
        class_prerequisite_id: 1,
      });

      await expect(
        service.createClassPrerequisite(
          10,
          { prerequisite_class_id: 5 },
          ACTOR_ID,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.ADMIN_CLASS_PREREQUISITE_DUPLICATE,
      });
    });

    it('throws on self-reference cycle', async () => {
      prismaMock.classes.findUnique
        .mockResolvedValueOnce({ class_id: 10 })
        .mockResolvedValueOnce({ class_id: 10 });

      await expect(
        service.createClassPrerequisite(
          10,
          { prerequisite_class_id: 10 },
          ACTOR_ID,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.ADMIN_CLASS_PREREQUISITE_CYCLE,
      });
    });

    it('throws on indirect cycle A→B then B→A', async () => {
      prismaMock.classes.findUnique
        .mockResolvedValueOnce({ class_id: 10 })
        .mockResolvedValueOnce({ class_id: 5 });
      // BFS from 5 finds that 5 already requires 10
      prismaMock.class_prerequisites.findMany.mockResolvedValue([
        { prerequisite_class_id: 10 },
      ]);

      await expect(
        service.createClassPrerequisite(
          10,
          { prerequisite_class_id: 5 },
          ACTOR_ID,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.ADMIN_CLASS_PREREQUISITE_CYCLE,
      });
    });

    it('soft-deletes a class prerequisite', async () => {
      prismaMock.class_prerequisites.findFirst.mockResolvedValue({
        class_prerequisite_id: 3,
        class_id: 10,
      });
      prismaMock.class_prerequisites.update.mockResolvedValue({
        class_prerequisite_id: 3,
        active: false,
      });

      const result = await service.deleteClassPrerequisite(10, 3, ACTOR_ID);
      expect(result.active).toBe(false);
    });

    it('throws when deleting missing prerequisite', async () => {
      prismaMock.class_prerequisites.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteClassPrerequisite(10, 999, ACTOR_ID),
      ).rejects.toMatchObject({
        code: ErrorCode.ADMIN_CLASS_PREREQUISITE_NOT_FOUND,
      });
    });
  });
});
