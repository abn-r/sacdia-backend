import { Test, TestingModule } from '@nestjs/testing';
import { AdminGeographyService } from './admin-geography.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CatalogCacheService,
  CATALOG_CACHE_KEYS,
} from '../catalogs/catalog-cache.service';
import { TranslationService } from '../common/services/translation.service';
import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

// ─── Mock factories ────────────────────────────────────────────────────────

const makePrismaMock = () => ({
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  countries: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  unions: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  local_fields: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  districts: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  churches: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  $transaction: jest.fn(),
});

const makeCacheMock = () => ({
  invalidate: jest.fn().mockResolvedValue(undefined),
  invalidateMany: jest.fn().mockResolvedValue(undefined),
});

const makeTranslationMock = () => ({
  validateTranslations: jest.fn(),
  upsertTranslations: jest.fn().mockResolvedValue(undefined),
  getCurrentLocale: jest.fn().mockReturnValue('es'),
  translateMany: jest.fn().mockImplementation((records) => records),
});

// ─── Fixtures ─────────────────────────────────────────────────────────────

const ACTOR_ID = 'actor-uuid';

const baseCountry = {
  country_id: 1,
  name: 'Argentina',
  abbreviation: 'AR',
  active: true,
  created_at: new Date(),
  modified_at: new Date(),
};

const baseUnion = {
  union_id: 1,
  name: 'Unión Argentina',
  abbreviation: 'UA',
  active: true,
  country_id: 1,
  division_id: 1,
  created_at: new Date(),
  modified_at: new Date(),
};

const baseDivision = {
  division_id: 1,
  code: 'DIA',
  name: 'División Interamericana',
  abbreviation: 'DIA',
  active: true,
  created_at: new Date(),
  modified_at: new Date(),
};

const baseLocalField = {
  local_field_id: 1,
  name: 'Campo Metropolitano',
  abbreviation: 'CM',
  active: true,
  union_id: 1,
  timezone: 'America/Mexico_City',
  created_at: new Date(),
  modified_at: new Date(),
};

const baseDistrict = {
  districlub_type_id: 1,
  name: 'Distrito Norte',
  active: true,
  local_field_id: 1,
  created_at: new Date(),
  modified_at: new Date(),
};

const baseChurch = {
  church_id: 1,
  name: 'Iglesia Central',
  active: true,
  districlub_type_id: 1,
  created_at: new Date(),
  modified_at: new Date(),
};

const ptBrTranslation = { locale: 'pt-BR' as const, name: 'Argentina (pt)' };
const enTranslation = { locale: 'en' as const, name: 'Argentina (en)' };

// ─── Test suite ───────────────────────────────────────────────────────────

describe('AdminGeographyService', () => {
  let service: AdminGeographyService;
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let cacheMock: ReturnType<typeof makeCacheMock>;
  let translationMock: ReturnType<typeof makeTranslationMock>;

  // Shared tx mock — re-used for $transaction stubs
  let txMock: Record<string, any>;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    cacheMock = makeCacheMock();
    translationMock = makeTranslationMock();

    // Default $transaction implementation: run the callback with a tx client
    // that forwards calls to the same mock tables.
    txMock = {
      countries: prismaMock.countries,
      unions: prismaMock.unions,
      local_fields: prismaMock.local_fields,
      districts: prismaMock.districts,
      churches: prismaMock.churches,
      $queryRaw: prismaMock.$queryRaw,
      $executeRaw: prismaMock.$executeRaw,
      divisions_translations: { upsert: jest.fn(), deleteMany: jest.fn() },
      countries_translations: { upsert: jest.fn(), deleteMany: jest.fn() },
      unions_translations: { upsert: jest.fn(), deleteMany: jest.fn() },
      local_fields_translations: { upsert: jest.fn(), deleteMany: jest.fn() },
      districts_translations: { upsert: jest.fn(), deleteMany: jest.fn() },
      churches_translations: { upsert: jest.fn(), deleteMany: jest.fn() },
    };

    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: typeof txMock) => Promise<any>) => fn(txMock),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminGeographyService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CatalogCacheService, useValue: cacheMock },
        { provide: TranslationService, useValue: translationMock },
      ],
    }).compile();

    service = module.get<AdminGeographyService>(AdminGeographyService);

    jest.clearAllMocks();

    // Re-apply after clearAllMocks
    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: typeof txMock) => Promise<any>) => fn(txMock),
    );
    cacheMock.invalidate.mockResolvedValue(undefined);
    cacheMock.invalidateMany.mockResolvedValue(undefined);
    translationMock.upsertTranslations.mockResolvedValue(undefined);
    prismaMock.$queryRaw.mockResolvedValue([baseUnion]);
    prismaMock.$executeRaw.mockResolvedValue(1);
  });

  describe('divisions', () => {
    it('creates division with translations and invalidates division catalog cache', async () => {
      prismaMock.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([baseDivision]);

      await expect(
        service.createDivision(
          {
            code: ' dia ',
            name: 'División Interamericana',
            abbreviation: 'dia',
            translations: [enTranslation],
          },
          ACTOR_ID,
        ),
      ).resolves.toEqual(baseDivision);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'divisions_translations',
        'division_id',
        'divisions_translations_unique_locale',
        baseDivision.division_id,
        [enTranslation],
        ['name'],
      );
      expect(cacheMock.invalidateMany).toHaveBeenCalledWith([
        CATALOG_CACHE_KEYS.DIVISIONS,
        CATALOG_CACHE_KEYS.SCORING_DEFAULT_DIVISION,
      ]);
    });

    it('rejects deactivating a division that still has active unions', async () => {
      prismaMock.$queryRaw
        .mockResolvedValueOnce([baseDivision])
        .mockResolvedValueOnce([{ count: 1 }]);

      await expect(service.deleteDivision(1, ACTOR_ID)).rejects.toMatchObject({
        code: ErrorCode.ADMIN_DIVISION_HAS_ACTIVE_UNIONS,
      });
    });
  });

  // =========================================================
  // COUNTRIES — createCountry
  // =========================================================

  describe('createCountry', () => {
    it('TC01 - creates country with pt-BR and en translations → tx.countries.create + upsertTranslations called with correct args', async () => {
      prismaMock.countries.findFirst.mockResolvedValue(null);
      prismaMock.countries.create.mockResolvedValue(baseCountry);

      const dto = {
        name: 'Argentina',
        abbreviation: 'AR',
        translations: [ptBrTranslation, enTranslation],
      };

      const result = await service.createCountry(dto, ACTOR_ID);

      expect(translationMock.validateTranslations).toHaveBeenCalledWith(
        dto.translations,
      );
      expect(prismaMock.countries.create).toHaveBeenCalledWith({
        data: { name: 'Argentina', abbreviation: 'AR', active: true },
      });
      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'countries_translations',
        'country_id',
        'countries_translations_unique_locale',
        baseCountry.country_id,
        dto.translations,
        ['name'],
      );
      expect(cacheMock.invalidate).toHaveBeenCalledWith(
        CATALOG_CACHE_KEYS.COUNTRIES,
      );
      expect(result).toEqual(baseCountry);
    });

    it('TC02 - creates country without translations → upsertTranslations called with undefined', async () => {
      prismaMock.countries.findFirst.mockResolvedValue(null);
      prismaMock.countries.create.mockResolvedValue(baseCountry);

      await service.createCountry(
        { name: 'Argentina', abbreviation: 'AR' },
        ACTOR_ID,
      );

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'countries_translations',
        'country_id',
        'countries_translations_unique_locale',
        baseCountry.country_id,
        undefined,
        ['name'],
      );
    });

    it('TC03 - validateTranslations throws → error propagates, create not called', async () => {
      prismaMock.countries.findFirst.mockResolvedValue(null);
      translationMock.validateTranslations.mockImplementation(() => {
        throw new AppBadRequestException(ErrorCode.TRANSLATIONS_ES_NOT_ALLOWED);
      });

      await expect(
        service.createCountry(
          {
            name: 'Argentina',
            abbreviation: 'AR',
            translations: [{ locale: 'es' as any, name: 'X' }],
          },
          ACTOR_ID,
        ),
      ).rejects.toThrow(AppBadRequestException);

      expect(prismaMock.countries.create).not.toHaveBeenCalled();
    });
  });

  // =========================================================
  // COUNTRIES — updateCountry
  // =========================================================

  describe('updateCountry', () => {
    beforeEach(() => {
      prismaMock.countries.findUnique.mockResolvedValue(baseCountry);
      prismaMock.countries.findFirst.mockResolvedValue(null);
      prismaMock.countries.update.mockResolvedValue(baseCountry);
    });

    it('TC04 - update with translations: [] → upsertTranslations called with empty array (delete-all semantics)', async () => {
      await service.updateCountry(1, { translations: [] }, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'countries_translations',
        'country_id',
        'countries_translations_unique_locale',
        1,
        [],
        ['name'],
      );
    });

    it('TC05 - update without translations field → upsertTranslations called with undefined (no-op)', async () => {
      await service.updateCountry(1, { name: 'Chile' }, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'countries_translations',
        'country_id',
        'countries_translations_unique_locale',
        1,
        undefined,
        ['name'],
      );
    });

    it('TC06 - validation error for locale "es" → error propagates before tx', async () => {
      translationMock.validateTranslations.mockImplementation(() => {
        throw new AppBadRequestException(ErrorCode.TRANSLATIONS_ES_NOT_ALLOWED);
      });

      await expect(
        service.updateCountry(
          1,
          { translations: [{ locale: 'es' as any, name: 'X' }] },
          ACTOR_ID,
        ),
      ).rejects.toThrow(AppBadRequestException);

      expect(prismaMock.countries.update).not.toHaveBeenCalled();
    });
  });

  // =========================================================
  // UNIONS — createUnion
  // =========================================================

  describe('createUnion', () => {
    it('TC07 - creates union with translations → upsertTranslations called with correct args', async () => {
      prismaMock.countries.findUnique.mockResolvedValue(baseCountry);
      prismaMock.unions.findFirst.mockResolvedValue(null);
      prismaMock.$queryRaw
        .mockResolvedValueOnce([baseDivision])
        .mockResolvedValueOnce([baseUnion]);

      const dto = {
        name: 'Unión Argentina',
        abbreviation: 'UA',
        country_id: 1,
        division_id: 1,
        translations: [ptBrTranslation],
      };

      await service.createUnion(dto, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'unions_translations',
        'union_id',
        'unions_translations_unique_locale',
        baseUnion.union_id,
        dto.translations,
        ['name'],
      );
      expect(prismaMock.$executeRaw).toHaveBeenCalled();
    });

    it('TC08 - update union with [] → upsertTranslations called with empty array', async () => {
      prismaMock.unions.findFirst.mockResolvedValue(null);
      prismaMock.$queryRaw
        .mockResolvedValueOnce([baseUnion])
        .mockResolvedValueOnce([baseUnion]);

      await service.updateUnion(1, { translations: [] }, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'unions_translations',
        'union_id',
        'unions_translations_unique_locale',
        1,
        [],
        ['name'],
      );
    });

    it('rejects legacy country-only union listing when the country maps to multiple divisions', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([
        { division_id: 1 },
        { division_id: 2 },
      ]);

      await expect(service.listUnions({ countryId: 1 })).rejects.toMatchObject({
        code: ErrorCode.HIERARCHY_COUNTRY_DIVISION_AMBIGUOUS,
      });
    });
  });

  // =========================================================
  // LOCAL FIELDS — createLocalField / updateLocalField
  // =========================================================

  describe('createLocalField', () => {
    it('TC09 - creates local field with translations → upsertTranslations called with correct args', async () => {
      prismaMock.unions.findUnique.mockResolvedValue(baseUnion);
      prismaMock.local_fields.findFirst.mockResolvedValue(null);
      prismaMock.local_fields.create.mockResolvedValue(baseLocalField);

      const dto = {
        name: 'Campo Metropolitano',
        abbreviation: 'CM',
        union_id: 1,
        timezone: 'America/Mexico_City',
        translations: [enTranslation],
      };

      await service.createLocalField(dto, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'local_fields_translations',
        'local_field_id',
        'local_fields_translations_unique_locale',
        baseLocalField.local_field_id,
        dto.translations,
        ['name'],
      );
    });

    it.each([
      { active: undefined, scenario: 'is omitted' },
      { active: true, scenario: 'is true' },
    ])('requires a timezone when active $scenario', async ({ active }) => {
      prismaMock.unions.findUnique.mockResolvedValue(baseUnion);

      const error = await service
        .createLocalField(
          {
            name: 'Campo sin zona',
            abbreviation: 'CSZ',
            union_id: 1,
            ...(active === undefined ? {} : { active }),
          },
          ACTOR_ID,
        )
        .catch((cause: unknown) => cause as AppBadRequestException);

      expect(error).toMatchObject({
        code: ErrorCode.LOCAL_FIELD_TIMEZONE_UNAVAILABLE,
      });
      expect(error.getResponse()).toMatchObject({
        namedArgs: { reason: 'MISSING' },
      });
    });

    it('allows an inactive local field without a timezone', async () => {
      prismaMock.unions.findUnique.mockResolvedValue(baseUnion);
      prismaMock.local_fields.findFirst.mockResolvedValue(null);
      prismaMock.local_fields.create.mockResolvedValue({
        ...baseLocalField,
        active: false,
        timezone: null,
      });

      await service.createLocalField(
        {
          name: 'Campo inactivo',
          abbreviation: 'CI',
          union_id: 1,
          active: false,
        },
        ACTOR_ID,
      );

      expect(prismaMock.local_fields.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ active: false, timezone: null }),
        }),
      );
    });

    it('TC10 - update local field without translations → upsertTranslations called with undefined', async () => {
      prismaMock.local_fields.findFirst.mockResolvedValue(null);
      prismaMock.$queryRaw.mockResolvedValueOnce([baseLocalField]);
      prismaMock.local_fields.update.mockResolvedValue(baseLocalField);

      await service.updateLocalField(1, { name: 'Campo Sur' }, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'local_fields_translations',
        'local_field_id',
        'local_fields_translations_unique_locale',
        1,
        undefined,
        ['name'],
      );
    });

    it('versions affected assignment holders when timezone changes', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([baseLocalField]);
      prismaMock.local_fields.update.mockResolvedValue({
        ...baseLocalField,
        timezone: 'America/Tijuana',
      });

      await service.updateLocalField(
        1,
        { timezone: 'America/Tijuana' },
        ACTOR_ID,
      );

      expect(txMock.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('locks and compares the current timezone inside the transaction', async () => {
      prismaMock.$queryRaw.mockResolvedValueOnce([
        { ...baseLocalField, timezone: 'America/Tijuana' },
      ]);
      prismaMock.local_fields.update.mockResolvedValue({
        ...baseLocalField,
        timezone: 'America/Tijuana',
      });

      await service.updateLocalField(
        1,
        { timezone: 'America/Tijuana' },
        ACTOR_ID,
      );

      const lockQuery = txMock.$queryRaw.mock.calls[0][0] as {
        strings: TemplateStringsArray;
      };
      expect(lockQuery.strings.join('?')).toContain('FOR UPDATE');
      expect(prismaMock.local_fields.findUnique).not.toHaveBeenCalled();
      expect(txMock.$executeRaw).not.toHaveBeenCalled();
    });
  });

  // =========================================================
  // DISTRICTS — createDistrict / updateDistrict
  // =========================================================

  describe('createDistrict', () => {
    it('TC11 - creates district with translations → upsertTranslations uses districlub_type_id (legacy FK name)', async () => {
      prismaMock.local_fields.findUnique.mockResolvedValue(baseLocalField);
      prismaMock.districts.findFirst.mockResolvedValue(null);
      prismaMock.districts.create.mockResolvedValue(baseDistrict);

      const dto = {
        name: 'Distrito Norte',
        local_field_id: 1,
        translations: [ptBrTranslation],
      };

      await service.createDistrict(dto, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'districts_translations',
        'districlub_type_id',
        'districts_translations_unique_locale',
        baseDistrict.districlub_type_id,
        dto.translations,
        ['name'],
      );
    });

    it('TC12 - update district with [] → upsertTranslations called with empty array', async () => {
      prismaMock.districts.findUnique.mockResolvedValue(baseDistrict);
      prismaMock.districts.findFirst.mockResolvedValue(null);
      prismaMock.districts.update.mockResolvedValue(baseDistrict);

      await service.updateDistrict(1, { translations: [] }, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'districts_translations',
        'districlub_type_id',
        'districts_translations_unique_locale',
        1,
        [],
        ['name'],
      );
    });
  });

  // =========================================================
  // CHURCHES — createChurch / updateChurch
  // =========================================================

  describe('createChurch', () => {
    it('TC13 - creates church with translations → upsertTranslations called with correct args', async () => {
      prismaMock.districts.findUnique.mockResolvedValue(baseDistrict);
      prismaMock.churches.findFirst.mockResolvedValue(null);
      prismaMock.churches.create.mockResolvedValue(baseChurch);

      const dto = {
        name: 'Iglesia Central',
        district_id: 1,
        translations: [ptBrTranslation, enTranslation],
      };

      await service.createChurch(dto, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'churches_translations',
        'church_id',
        'churches_translations_unique_locale',
        baseChurch.church_id,
        dto.translations,
        ['name'],
      );
    });

    it('TC14 - update church without translations → upsertTranslations called with undefined', async () => {
      prismaMock.churches.findUnique.mockResolvedValue(baseChurch);
      prismaMock.churches.findFirst.mockResolvedValue(null);
      prismaMock.churches.update.mockResolvedValue(baseChurch);

      await service.updateChurch(1, { name: 'Iglesia Sur' }, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'churches_translations',
        'church_id',
        'churches_translations_unique_locale',
        1,
        undefined,
        ['name'],
      );
    });

    it('TC15 - update church with [] → upsertTranslations called with empty array', async () => {
      prismaMock.churches.findUnique.mockResolvedValue(baseChurch);
      prismaMock.churches.findFirst.mockResolvedValue(null);
      prismaMock.churches.update.mockResolvedValue(baseChurch);

      await service.updateChurch(1, { translations: [] }, ACTOR_ID);

      expect(translationMock.upsertTranslations).toHaveBeenCalledWith(
        txMock,
        'churches_translations',
        'church_id',
        'churches_translations_unique_locale',
        1,
        [],
        ['name'],
      );
    });

    it('TC16 - validateTranslations throws for "es" locale → error propagates, update not called', async () => {
      prismaMock.churches.findUnique.mockResolvedValue(baseChurch);
      translationMock.validateTranslations.mockImplementation(() => {
        throw new AppBadRequestException(ErrorCode.TRANSLATIONS_ES_NOT_ALLOWED);
      });

      await expect(
        service.updateChurch(
          1,
          { translations: [{ locale: 'es' as any, name: 'X' }] },
          ACTOR_ID,
        ),
      ).rejects.toThrow(AppBadRequestException);

      expect(prismaMock.churches.update).not.toHaveBeenCalled();
    });
  });
});
