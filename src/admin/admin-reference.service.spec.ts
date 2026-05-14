import { Test, TestingModule } from '@nestjs/testing';
import { ErrorCode } from '../common/errors/error-codes';
import { AdminReferenceService } from './admin-reference.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CatalogCacheService,
  CATALOG_CACHE_KEYS,
} from '../catalogs/catalog-cache.service';
import { TranslationService } from '../common/services/translation.service';
import { AppBadRequestException } from '../common/errors/app.exception';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ACTOR_ID = 'actor-uuid';

const baseAllergy = {
  allergy_id: 1,
  name: 'Polen',
  description: 'Alergia al polen',
  active: true,
  created_at: new Date(),
  modified_at: new Date(),
};

const baseClubIdeal = {
  club_ideal_id: 2,
  name: 'Leal',
  ideal: 'El conquistador es leal a Dios.',
  ideal_order: 1,
  club_type_id: 1,
  active: true,
  created_at: new Date(),
  modified_at: new Date(),
};

const baseClubType = {
  club_type_id: 1,
  name: 'Conquistadores',
  active: true,
  created_at: new Date(),
  modified_at: new Date(),
};

const baseActivityType = {
  activity_type_id: 3,
  code: 'CULTO',
  name: 'Culto',
  description: 'Servicio de adoración',
  active: true,
  created_at: new Date(),
  modified_at: new Date(),
};

const baseRelationshipType = {
  relationship_type_id: 'uuid-rel-type-1',
  name: 'Padre',
  description: 'Relación padre',
  active: true,
  created_at: new Date(),
  modified_at: new Date(),
};

// ─── Mock factories ───────────────────────────────────────────────────────────

const makePrismaMock = () => ({
  activity_types: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  relationship_types: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  allergies: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  diseases: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  medicines: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  club_types: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  club_ideals: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  ecclesiastical_years: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  honors_categories: {
    findMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  users_allergies: { count: jest.fn() },
  users_diseases: { count: jest.fn() },
  users_medicines: { count: jest.fn() },
  legal_representatives: { count: jest.fn() },
  club_sections: { count: jest.fn() },
  club_role_assignments: { count: jest.fn() },
  activities: { count: jest.fn() },
  honors: { count: jest.fn() },
  $transaction: jest.fn(),
});

const makeCacheMock = () => ({
  invalidate: jest.fn().mockResolvedValue(undefined),
  invalidateMany: jest.fn().mockResolvedValue(undefined),
  invalidateAll: jest.fn().mockResolvedValue(undefined),
});

const makeTranslationMock = () => ({
  validateTranslations: jest.fn(),
  upsertTranslations: jest.fn().mockResolvedValue(undefined),
  getCurrentLocale: jest.fn().mockReturnValue('es'),
  translateMany: jest.fn().mockImplementation((records: any[]) => records),
});

// ─── Test suite ──────────────────────────────────────────────────────────────

describe('AdminReferenceService', () => {
  let service: AdminReferenceService;
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let cacheMock: ReturnType<typeof makeCacheMock>;
  let translationMock: ReturnType<typeof makeTranslationMock>;
  let txMock: Record<string, any>;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    cacheMock = makeCacheMock();
    translationMock = makeTranslationMock();

    txMock = {
      activity_types: prismaMock.activity_types,
      relationship_types: prismaMock.relationship_types,
      allergies: prismaMock.allergies,
      diseases: prismaMock.diseases,
      medicines: prismaMock.medicines,
      club_types: prismaMock.club_types,
      club_ideals: prismaMock.club_ideals,
      ecclesiastical_years: prismaMock.ecclesiastical_years,
      honors_categories: prismaMock.honors_categories,
      allergies_translations: { upsert: jest.fn(), deleteMany: jest.fn() },
      diseases_translations: { upsert: jest.fn(), deleteMany: jest.fn() },
      medicines_translations: { upsert: jest.fn(), deleteMany: jest.fn() },
      club_types_translations: { upsert: jest.fn(), deleteMany: jest.fn() },
      club_ideals_translations: { upsert: jest.fn(), deleteMany: jest.fn() },
      activity_types_translations: { upsert: jest.fn(), deleteMany: jest.fn() },
      relationship_types_translations: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
      honors_categories_translations: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: typeof txMock) => Promise<any>) => fn(txMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminReferenceService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CatalogCacheService, useValue: cacheMock },
        { provide: TranslationService, useValue: translationMock },
      ],
    }).compile();

    service = module.get<AdminReferenceService>(AdminReferenceService);

    jest.clearAllMocks();

    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: typeof txMock) => Promise<any>) => fn(txMock),
    );
    cacheMock.invalidate.mockResolvedValue(undefined);
    cacheMock.invalidateMany.mockResolvedValue(undefined);
    translationMock.upsertTranslations.mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // =========================================================
  // HONOR CATEGORIES (pre-existing tests — unchanged logic)
  // =========================================================

  describe('listHonorCategories', () => {
    it('should return paginated honor categories', async () => {
      const items = [
        {
          honor_category_id: 1,
          name: 'Naturaleza',
          _count: { honors: 2 },
        },
      ];

      prismaMock.honors_categories.findMany.mockResolvedValue(items);
      prismaMock.honors_categories.count.mockResolvedValue(1);

      const result = await service.listHonorCategories({
        page: 2,
        limit: 10,
        search: 'nature',
      } as unknown as Parameters<typeof service.listHonorCategories>[0]);

      expect(result).toEqual({
        items,
        total: 1,
        page: 2,
        limit: 10,
      });
      expect(prismaMock.honors_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            name: {
              contains: 'nature',
              mode: 'insensitive',
            },
          },
          skip: 10,
          take: 10,
          orderBy: { name: 'asc' },
          include: {
            _count: {
              select: { honors: true },
            },
          },
        }),
      );
    });

    it('should list all categories without search', async () => {
      prismaMock.honors_categories.findMany.mockResolvedValue([]);
      prismaMock.honors_categories.count.mockResolvedValue(0);

      await service.listHonorCategories();

      expect(prismaMock.honors_categories.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          skip: 0,
          take: 20,
        }),
      );
    });
  });

  describe('getHonorCategory', () => {
    it('should return honor category by id', async () => {
      const category = {
        honor_category_id: 3,
        name: 'Espiritualidad',
        _count: { honors: 4 },
      };

      prismaMock.honors_categories.findUniqueOrThrow.mockResolvedValue(
        category,
      );

      const result = await service.getHonorCategory(3);

      expect(result).toEqual(category);
      expect(
        prismaMock.honors_categories.findUniqueOrThrow,
      ).toHaveBeenCalledWith({
        where: { honor_category_id: 3 },
        include: {
          _count: {
            select: { honors: true },
          },
        },
      });
    });
  });

  describe('createHonorCategory', () => {
    it('should create a new honor category', async () => {
      const created = {
        honor_category_id: 7,
        name: 'Naturaleza',
        description: 'Especialidades de naturaleza',
        icon: 12,
        active: true,
        _count: { honors: 0 },
      };

      prismaMock.honors_categories.findFirst.mockResolvedValue(null);
      prismaMock.honors_categories.create.mockResolvedValue(created);

      const result = await service.createHonorCategory(
        {
          name: '  Naturaleza  ',
          description: 'Especialidades de naturaleza',
          icon: 12,
        },
        'actor-1',
      );

      expect(result).toEqual(created);
      expect(prismaMock.honors_categories.findFirst).toHaveBeenCalledWith({
        where: {
          name: { equals: 'Naturaleza', mode: 'insensitive' },
        },
      });
      expect(prismaMock.honors_categories.create).toHaveBeenCalledWith({
        data: {
          name: 'Naturaleza',
          description: 'Especialidades de naturaleza',
          icon: 12,
          active: true,
        },
        include: {
          _count: {
            select: { honors: true },
          },
        },
      });
    });

    it('should throw when honor category already exists', async () => {
      prismaMock.honors_categories.findFirst.mockResolvedValue({
        honor_category_id: 1,
      });

      await expect(
        service.createHonorCategory({ name: 'Naturaleza' }, 'actor-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.ADMIN_HONOR_CATEGORY_NAME_CONFLICT,
      });
    });
  });

  describe('updateHonorCategory', () => {
    it('should update an honor category', async () => {
      const current = { honor_category_id: 5, name: 'Naturaleza' };
      const updated = {
        honor_category_id: 5,
        name: 'Naturaleza renovada',
        description: 'Nueva descripción',
        icon: null,
        active: false,
        modified_at: new Date('2026-03-18T00:00:00.000Z'),
        _count: { honors: 1 },
      };

      prismaMock.honors_categories.findUnique.mockResolvedValue(current);
      prismaMock.honors_categories.findFirst.mockResolvedValue(null);
      prismaMock.honors_categories.update.mockResolvedValue(updated);

      const result = await service.updateHonorCategory(
        5,
        {
          name: ' Naturaleza renovada ',
          description: 'Nueva descripción',
          icon: null,
          active: false,
        },
        'actor-2',
      );

      expect(result).toEqual(updated);
      expect(prismaMock.honors_categories.findUnique).toHaveBeenCalledWith({
        where: { honor_category_id: 5 },
      });
      expect(prismaMock.honors_categories.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { honor_category_id: 5 },
          data: expect.objectContaining({
            name: 'Naturaleza renovada',
            description: 'Nueva descripción',
            icon: null,
            active: false,
          }),
          include: {
            _count: {
              select: { honors: true },
            },
          },
        }),
      );
    });

    it('should throw when honor category is missing', async () => {
      prismaMock.honors_categories.findUnique.mockResolvedValue(null);

      await expect(
        service.updateHonorCategory(9, { name: 'Nuevo nombre' }, 'actor-2'),
      ).rejects.toMatchObject({
        code: ErrorCode.ADMIN_HONOR_CATEGORY_NOT_FOUND,
      });
    });
  });

  describe('deleteHonorCategory', () => {
    it('should deactivate an honor category when not in use', async () => {
      const existing = { honor_category_id: 11, name: 'Servicio' };
      const deleted = {
        honor_category_id: 11,
        name: 'Servicio',
        active: false,
        _count: { honors: 0 },
      };

      prismaMock.honors_categories.findUnique.mockResolvedValue(existing);
      prismaMock.honors.count.mockResolvedValue(0);
      prismaMock.honors_categories.update.mockResolvedValue(deleted);

      const result = await service.deleteHonorCategory(11, 'actor-3');

      expect(result).toEqual(deleted);
      expect(prismaMock.honors.count).toHaveBeenCalledWith({
        where: {
          honors_category_id: 11,
          active: true,
        },
      });
      expect(prismaMock.honors_categories.update).toHaveBeenCalledWith({
        where: { honor_category_id: 11 },
        data: {
          active: false,
          modified_at: expect.any(Date),
        },
        include: {
          _count: {
            select: { honors: true },
          },
        },
      });
    });

    it('should throw when honor category is in use', async () => {
      prismaMock.honors_categories.findUnique.mockResolvedValue({
        honor_category_id: 12,
      });
      prismaMock.honors.count.mockResolvedValue(1);

      await expect(
        service.deleteHonorCategory(12, 'actor-3'),
      ).rejects.toMatchObject({
        code: ErrorCode.ADMIN_HONOR_CATEGORY_IN_USE,
      });
    });
  });

  describe('listClubIdeals', () => {
    it('should return all club ideals ordered by club type and ideal order (with translations)', async () => {
      const ideals = [
        {
          club_ideal_id: 2,
          name: 'Amor',
          ideal_order: 1,
          club_type_id: 1,
          translations: [],
        },
        {
          club_ideal_id: 4,
          name: 'Servicio',
          ideal_order: 2,
          club_type_id: 1,
          translations: [],
        },
      ];

      prismaMock.club_ideals.findMany.mockResolvedValue(ideals);

      const result = await service.listClubIdeals();

      expect(result).toEqual(ideals);
      expect(prismaMock.club_ideals.findMany).toHaveBeenCalledWith({
        orderBy: [{ club_type_id: 'asc' }, { ideal_order: 'asc' }],
        take: 200,
        include: { translations: true },
      });
    });
  });

  // =========================================================
  // ALLERGIES — createAllergy (PR-3)
  // =========================================================

  describe('createAllergy', () => {
    it('TC01 - creates allergy with pt-BR and en translations → upsertTranslations called with correct args', async () => {
      prismaMock.allergies.findFirst.mockResolvedValue(null);
      prismaMock.allergies.create.mockResolvedValue(baseAllergy);

      const dto = {
        name: 'Polen',
        translations: [
          {
            locale: 'pt-BR' as const,
            name: 'Pólen',
            description: 'Alergia ao pólen',
          },
          {
            locale: 'en' as const,
            name: 'Pollen',
            description: 'Pollen allergy',
          },
        ],
      };

      const result = await service.createAllergy(dto, ACTOR_ID);

      expect(translationMock.validateTranslations).toHaveBeenCalledWith(
        dto.translations,
      );
      expect(prismaMock.allergies.create).toHaveBeenCalledWith({
        data: { name: 'Polen', description: undefined, active: true },
      });
      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'allergies_translations',
        'allergy_id',
        'allergies_translations_unique_locale',
        baseAllergy.allergy_id,
        dto.translations,
        ['name', 'description'],
      );
      expect(cacheMock.invalidate).toHaveBeenCalledWith(
        CATALOG_CACHE_KEYS.ALLERGIES,
      );
      expect(result).toEqual(baseAllergy);
    });

    it('TC02 - creates allergy without translations → upsertTranslations called with undefined', async () => {
      prismaMock.allergies.findFirst.mockResolvedValue(null);
      prismaMock.allergies.create.mockResolvedValue(baseAllergy);

      await service.createAllergy({ name: 'Polen' }, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'allergies_translations',
        'allergy_id',
        'allergies_translations_unique_locale',
        baseAllergy.allergy_id,
        undefined,
        ['name', 'description'],
      );
    });

    it('TC03 - validateTranslations throws for "es" locale → error propagates, create not called', async () => {
      prismaMock.allergies.findFirst.mockResolvedValue(null);
      translationMock.validateTranslations.mockImplementation(() => {
        throw new AppBadRequestException(ErrorCode.TRANSLATIONS_ES_NOT_ALLOWED);
      });

      await expect(
        service.createAllergy(
          { name: 'Polen', translations: [{ locale: 'es' as any, name: 'X' }] },
          ACTOR_ID,
        ),
      ).rejects.toThrow(AppBadRequestException);

      expect(prismaMock.allergies.create).not.toHaveBeenCalled();
    });
  });

  // =========================================================
  // ALLERGIES — updateAllergy
  // =========================================================

  describe('updateAllergy', () => {
    beforeEach(() => {
      prismaMock.allergies.findUnique.mockResolvedValue(baseAllergy);
      prismaMock.allergies.findFirst.mockResolvedValue(null);
      prismaMock.allergies.update.mockResolvedValue(baseAllergy);
    });

    it('TC04 - update with translations: [] → upsertTranslations called with empty array (delete-all semantics)', async () => {
      await service.updateAllergy(1, { translations: [] }, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'allergies_translations',
        'allergy_id',
        'allergies_translations_unique_locale',
        1,
        [],
        ['name', 'description'],
      );
    });

    it('TC05 - update without translations field → upsertTranslations called with undefined (no-op)', async () => {
      await service.updateAllergy(1, { name: 'Polvo' }, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'allergies_translations',
        'allergy_id',
        'allergies_translations_unique_locale',
        1,
        undefined,
        ['name', 'description'],
      );
    });
  });

  // =========================================================
  // CLUB IDEALS — createClubIdeal (critical: fields=['name','ideal'])
  // =========================================================

  describe('createClubIdeal', () => {
    it('TC06 - creates club ideal with en translation → upsertTranslations called with fields: ["name","ideal"]', async () => {
      prismaMock.club_types.findUnique.mockResolvedValue(baseClubType);
      prismaMock.club_ideals.create.mockResolvedValue(baseClubIdeal);

      const dto = {
        name: 'Leal',
        club_type_id: 1,
        ideal_order: 1,
        ideal: 'El conquistador es leal a Dios.',
        translations: [
          {
            locale: 'en' as const,
            name: 'Loyal',
            ideal: 'The pathfinder is loyal to God.',
          },
        ],
      };

      await service.createClubIdeal(dto, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'club_ideals_translations',
        'club_ideal_id',
        'club_ideals_translations_unique_locale',
        baseClubIdeal.club_ideal_id,
        dto.translations,
        ['name', 'ideal'],
      );
    });

    it('TC07 - club ideal upsertTranslations is called with fields ["name","ideal"] — NOT ["name","description"]', async () => {
      prismaMock.club_types.findUnique.mockResolvedValue(baseClubType);
      prismaMock.club_ideals.create.mockResolvedValue(baseClubIdeal);

      const translations = [
        {
          locale: 'pt-BR' as const,
          name: 'Leal',
          ideal: 'O desbravador é leal.',
        },
      ];
      await service.createClubIdeal(
        { name: 'Leal', club_type_id: 1, ideal_order: 1, translations },
        ACTOR_ID,
      );

      const call = translationMock.upsertTranslations.mock.calls[0];
      // 7th argument (index 6) is the fields array
      expect(call[6]).toEqual(['name', 'ideal']);
      expect(call[6]).not.toContain('description');
    });

    it('TC08 - creates club ideal without translations → upsertTranslations called with undefined', async () => {
      prismaMock.club_types.findUnique.mockResolvedValue(baseClubType);
      prismaMock.club_ideals.create.mockResolvedValue(baseClubIdeal);

      await service.createClubIdeal(
        { name: 'Leal', club_type_id: 1, ideal_order: 1 },
        ACTOR_ID,
      );

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'club_ideals_translations',
        'club_ideal_id',
        'club_ideals_translations_unique_locale',
        baseClubIdeal.club_ideal_id,
        undefined,
        ['name', 'ideal'],
      );
    });
  });

  // =========================================================
  // CLUB IDEALS — updateClubIdeal
  // =========================================================

  describe('updateClubIdeal', () => {
    beforeEach(() => {
      prismaMock.club_ideals.findUnique.mockResolvedValue(baseClubIdeal);
      prismaMock.club_ideals.update.mockResolvedValue(baseClubIdeal);
    });

    it('TC09 - update with translations: [] → upsertTranslations called with [] and fields: ["name","ideal"]', async () => {
      await service.updateClubIdeal(2, { translations: [] }, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'club_ideals_translations',
        'club_ideal_id',
        'club_ideals_translations_unique_locale',
        2,
        [],
        ['name', 'ideal'],
      );
    });

    it('TC10 - update without translations field → upsertTranslations called with undefined (no-op)', async () => {
      await service.updateClubIdeal(2, { name: 'Puro' }, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'club_ideals_translations',
        'club_ideal_id',
        'club_ideals_translations_unique_locale',
        2,
        undefined,
        ['name', 'ideal'],
      );
    });
  });

  // =========================================================
  // CLUB TYPES — createClubType (name only, description ignored)
  // =========================================================

  describe('createClubType', () => {
    it('TC11 - creates club type with translations → upsertTranslations called with fields: ["name"] only', async () => {
      prismaMock.club_types.findFirst.mockResolvedValue(null);
      prismaMock.club_types.create.mockResolvedValue(baseClubType);

      const dto = {
        name: 'Conquistadores',
        translations: [
          {
            locale: 'en' as const,
            name: 'Pathfinders',
            description: 'should be ignored by helper',
          },
        ],
      };

      await service.createClubType(dto, ACTOR_ID);

      const call = translationMock.upsertTranslations.mock.calls[0];
      expect(call[6]).toEqual(['name']);
      // description is silently ignored — not in the fields array passed to the helper
      expect(call[6]).not.toContain('description');
    });
  });

  // =========================================================
  // ACTIVITY TYPES — createActivityType (code NOT translated)
  // =========================================================

  describe('createActivityType', () => {
    it('TC12 - creates activity type → code field is NOT in translation fields', async () => {
      prismaMock.activity_types.findFirst.mockResolvedValue(null);
      prismaMock.activity_types.create.mockResolvedValue(baseActivityType);

      const dto = {
        code: 'CULTO',
        name: 'Culto',
        translations: [
          {
            locale: 'en' as const,
            name: 'Worship',
            description: 'Weekly worship service',
          },
        ],
      };

      await service.createActivityType(dto, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'activity_types_translations',
        'activity_type_id',
        'activity_types_translations_unique_locale',
        baseActivityType.activity_type_id,
        dto.translations,
        ['name', 'description'],
      );

      const call = translationMock.upsertTranslations.mock.calls[0];
      expect(call[6]).not.toContain('code');
    });
  });

  // =========================================================
  // RELATIONSHIP TYPES — createRelationshipType (UUID PK)
  // =========================================================

  describe('createRelationshipType', () => {
    it('TC13 - creates relationship type with UUID PK → recordId passed as string (no Int coercion)', async () => {
      prismaMock.relationship_types.findFirst.mockResolvedValue(null);
      prismaMock.relationship_types.create.mockResolvedValue(
        baseRelationshipType,
      );

      const dto = {
        name: 'Padre',
        translations: [
          {
            locale: 'en' as const,
            name: 'Father',
            description: 'Parent-child relation',
          },
        ],
      };

      await service.createRelationshipType(dto, ACTOR_ID);

      const call = translationMock.upsertTranslations.mock.calls[0];
      const recordId = call[4];
      expect(typeof recordId).toBe('string');
      expect(recordId).toBe(baseRelationshipType.relationship_type_id);
    });

    it('TC14 - creates relationship type with translations → upsertTranslations called with correct unique name', async () => {
      prismaMock.relationship_types.findFirst.mockResolvedValue(null);
      prismaMock.relationship_types.create.mockResolvedValue(
        baseRelationshipType,
      );

      const dto = {
        name: 'Padre',
        translations: [
          {
            locale: 'pt-BR' as const,
            name: 'Pai',
            description: 'Relação pai-filho',
          },
        ],
      };

      await service.createRelationshipType(dto, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'relationship_types_translations',
        'relationship_type_id',
        'relationship_types_translations_unique_locale',
        baseRelationshipType.relationship_type_id,
        dto.translations,
        ['name', 'description'],
      );
    });
  });

  // =========================================================
  // RELATIONSHIP TYPES — updateRelationshipType
  // =========================================================

  describe('updateRelationshipType', () => {
    beforeEach(() => {
      prismaMock.relationship_types.findUnique.mockResolvedValue(
        baseRelationshipType,
      );
      prismaMock.relationship_types.findFirst.mockResolvedValue(null);
      prismaMock.relationship_types.update.mockResolvedValue(
        baseRelationshipType,
      );
    });

    it('TC15 - update with translations: [] → upsertTranslations called with empty array (delete-all)', async () => {
      await service.updateRelationshipType(
        'uuid-rel-type-1',
        { translations: [] },
        ACTOR_ID,
      );

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'relationship_types_translations',
        'relationship_type_id',
        'relationship_types_translations_unique_locale',
        'uuid-rel-type-1',
        [],
        ['name', 'description'],
      );
    });

    it('TC16 - update without translations field → upsertTranslations called with undefined (no-op)', async () => {
      await service.updateRelationshipType(
        'uuid-rel-type-1',
        { name: 'Madre' },
        ACTOR_ID,
      );

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'relationship_types_translations',
        'relationship_type_id',
        'relationship_types_translations_unique_locale',
        'uuid-rel-type-1',
        undefined,
        ['name', 'description'],
      );
    });
  });
});
