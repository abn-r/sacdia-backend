import { Test, TestingModule } from '@nestjs/testing';
import { TranslationService } from './translation.service';
import { I18nContext } from 'nestjs-i18n';
import { AppBadRequestException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

jest.mock('nestjs-i18n', () => ({
  I18nContext: {
    current: jest.fn(),
  },
}));

const mockI18nCurrent = I18nContext.current as jest.MockedFunction<
  typeof I18nContext.current
>;

describe('TranslationService', () => {
  let service: TranslationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TranslationService],
    }).compile();

    service = module.get<TranslationService>(TranslationService);
    jest.clearAllMocks();
  });

  // ========================================================
  // getCurrentLocale
  // ========================================================
  describe('getCurrentLocale', () => {
    it('returns the locale from I18nContext', () => {
      mockI18nCurrent.mockReturnValue({ lang: 'en' } as any);
      expect(service.getCurrentLocale()).toBe('en');
    });

    it("defaults to 'es' when no I18nContext is active", () => {
      mockI18nCurrent.mockReturnValue(undefined as any);
      expect(service.getCurrentLocale()).toBe('es');
    });

    it("defaults to 'es' when I18nContext has no lang", () => {
      mockI18nCurrent.mockReturnValue({} as any);
      expect(service.getCurrentLocale()).toBe('es');
    });
  });

  // ========================================================
  // translate — single record
  // ========================================================
  describe('translate', () => {
    type Category = {
      honor_category_id: number;
      name: string;
      description: string | null;
    };

    const spanishRecord: Category = {
      honor_category_id: 1,
      name: 'ADRA',
      description: 'Especialidades relacionadas con ADRA',
    };

    it("returns record unchanged when locale is 'es'", () => {
      const translations = [
        { locale: 'en', name: 'ADRA EN', description: 'ADRA activities EN' },
      ];
      const result = service.translate(spanishRecord, translations, 'es', [
        'name',
        'description',
      ]);
      expect(result).toEqual(spanishRecord);
      // Ensure it is the same object reference (no copy created for es)
      expect(result).toBe(spanishRecord);
    });

    it('overlays fields when translation exists for the requested locale', () => {
      const translations = [
        { locale: 'en', name: 'ADRA EN', description: 'ADRA activities EN' },
      ];
      const result = service.translate(spanishRecord, translations, 'en', [
        'name',
        'description',
      ]);
      expect(result.name).toBe('ADRA EN');
      expect(result.description).toBe('ADRA activities EN');
      expect(result.honor_category_id).toBe(1); // non-translated field preserved
    });

    it('returns record unchanged when no translation exists for the locale', () => {
      const translations: Array<Partial<Category> & { locale: string }> = [];
      const result = service.translate(spanishRecord, translations, 'fr', [
        'name',
        'description',
      ]);
      expect(result).toEqual(spanishRecord);
    });

    it('only overlays fields with non-null values from translation', () => {
      // Translation has name but null description — description should keep Spanish value.
      const translations = [
        { locale: 'pt-BR', name: 'ADRA PT', description: null },
      ];
      const result = service.translate(spanishRecord, translations, 'pt-BR', [
        'name',
        'description',
      ]);
      expect(result.name).toBe('ADRA PT');
      // null from translation → keep Spanish fallback
      expect(result.description).toBe('Especialidades relacionadas con ADRA');
    });

    it('does not mutate the original record', () => {
      const original = { ...spanishRecord };
      const translations = [
        { locale: 'en', name: 'ADRA EN', description: 'ADRA EN desc' },
      ];
      service.translate(spanishRecord, translations, 'en', [
        'name',
        'description',
      ]);
      expect(spanishRecord).toEqual(original);
    });
  });

  // ========================================================
  // translateMany
  // ========================================================
  describe('translateMany', () => {
    type CategoryWithTranslations = {
      honor_category_id: number;
      name: string;
      description: string | null;
      icon: number | null;
      translations: Array<{
        locale: string;
        name: string | null;
        description: string | null;
      }>;
    };

    const records: CategoryWithTranslations[] = [
      {
        honor_category_id: 1,
        name: 'ADRA',
        description: 'Desc ADRA',
        icon: 1,
        translations: [
          { locale: 'en', name: 'ADRA EN', description: 'ADRA EN desc' },
        ],
      },
      {
        honor_category_id: 2,
        name: 'Agropecuarias',
        description: 'Desc Agro',
        icon: 2,
        translations: [], // no en translation — should fall back to Spanish
      },
    ];

    it('applies translations and strips the translations key from output', () => {
      const results = service.translateMany(
        records,
        'en',
        ['name', 'description'],
        'translations',
      );

      expect(results).toHaveLength(2);
      // Record with translation
      expect(results[0]).not.toHaveProperty('translations');
      expect((results[0] as any).name).toBe('ADRA EN');
      expect((results[0] as any).description).toBe('ADRA EN desc');

      // Record without translation — Spanish fallback
      expect(results[1]).not.toHaveProperty('translations');
      expect((results[1] as any).name).toBe('Agropecuarias');
      expect((results[1] as any).description).toBe('Desc Agro');
    });

    it('returns Spanish values for all records when locale is es', () => {
      const results = service.translateMany(
        records,
        'es',
        ['name', 'description'],
        'translations',
      );

      expect(results[0]).not.toHaveProperty('translations');
      expect((results[0] as any).name).toBe('ADRA');
      expect((results[1] as any).name).toBe('Agropecuarias');
    });

    it('preserves non-translated fields on each record', () => {
      const results = service.translateMany(
        records,
        'en',
        ['name', 'description'],
        'translations',
      );
      expect((results[0] as any).icon).toBe(1);
      expect((results[0] as any).honor_category_id).toBe(1);
    });

    it('returns empty array for empty input', () => {
      const results = service.translateMany([], 'en', ['name'], 'translations');
      expect(results).toEqual([]);
    });
  });

  // ========================================================
  // validateTranslations
  // ========================================================
  describe('validateTranslations', () => {
    it('is a no-op when translations is undefined', () => {
      expect(() => service.validateTranslations(undefined)).not.toThrow();
    });

    it('is a no-op for an empty array', () => {
      expect(() => service.validateTranslations([])).not.toThrow();
    });

    it('accepts valid locales without throwing', () => {
      expect(() =>
        service.validateTranslations([
          { locale: 'en', name: 'English name' },
          { locale: 'pt-BR', name: 'PT name' },
          { locale: 'fr', name: 'FR name' },
        ]),
      ).not.toThrow();
    });

    it('throws TRANSLATIONS_ES_NOT_ALLOWED when locale is es', () => {
      let caught: AppBadRequestException | null = null;
      try {
        service.validateTranslations([{ locale: 'es', name: 'Spanish' }]);
      } catch (e) {
        caught = e as AppBadRequestException;
      }
      expect(caught).not.toBeNull();
      expect(caught!.code).toBe(ErrorCode.TRANSLATIONS_ES_NOT_ALLOWED);
    });

    it('throws TRANSLATIONS_INVALID_LOCALE for an unsupported locale', () => {
      let caught: AppBadRequestException | null = null;
      try {
        service.validateTranslations([{ locale: 'de', name: 'German' }]);
      } catch (e) {
        caught = e as AppBadRequestException;
      }
      expect(caught).not.toBeNull();
      expect(caught!.code).toBe(ErrorCode.TRANSLATIONS_INVALID_LOCALE);
    });

    it('throws TRANSLATIONS_DUPLICATE_LOCALE when the same locale appears twice', () => {
      let caught: AppBadRequestException | null = null;
      try {
        service.validateTranslations([
          { locale: 'en', name: 'English 1' },
          { locale: 'en', name: 'English 2' },
        ]);
      } catch (e) {
        caught = e as AppBadRequestException;
      }
      expect(caught).not.toBeNull();
      expect(caught!.code).toBe(ErrorCode.TRANSLATIONS_DUPLICATE_LOCALE);
    });
  });

  // ========================================================
  // upsertTranslations
  // ========================================================
  describe('upsertTranslations', () => {
    const makeTx = () => ({
      honors_categories_translations: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    });

    it('is a no-op when translations is undefined', async () => {
      const tx = makeTx();
      await service.upsertTranslations(
        tx,
        'honors_categories_translations',
        'honor_category_id',
        'honor_category_id_locale',
        1,
        undefined,
      );
      expect(
        tx.honors_categories_translations.deleteMany,
      ).not.toHaveBeenCalled();
      expect(tx.honors_categories_translations.upsert).not.toHaveBeenCalled();
    });

    it('calls deleteMany when translations is an empty array', async () => {
      const tx = makeTx();
      await service.upsertTranslations(
        tx,
        'honors_categories_translations',
        'honor_category_id',
        'honor_category_id_locale',
        1,
        [],
      );
      expect(tx.honors_categories_translations.deleteMany).toHaveBeenCalledWith(
        {
          where: { honor_category_id: 1 },
        },
      );
      expect(tx.honors_categories_translations.upsert).not.toHaveBeenCalled();
    });

    it('calls upsert for each translation entry', async () => {
      const tx = makeTx();
      await service.upsertTranslations(
        tx,
        'honors_categories_translations',
        'honor_category_id',
        'honor_category_id_locale',
        42,
        [
          { locale: 'en', name: 'English', description: 'EN desc' },
          { locale: 'pt-BR', name: 'Portuguese', description: '' },
        ],
      );
      expect(tx.honors_categories_translations.upsert).toHaveBeenCalledTimes(2);
      // Empty string for description should be stored as null
      const secondCall =
        tx.honors_categories_translations.upsert.mock.calls[1][0];
      expect(secondCall.create.description).toBeNull();
    });

    it('stores empty string name as null', async () => {
      const tx = makeTx();
      await service.upsertTranslations(
        tx,
        'honors_categories_translations',
        'honor_category_id',
        'honor_category_id_locale',
        5,
        [{ locale: 'fr', name: '', description: 'FR desc' }],
      );
      const call = tx.honors_categories_translations.upsert.mock.calls[0][0];
      expect(call.create.name).toBeNull();
      expect(call.create.description).toBe('FR desc');
    });

    // ── fields: ['name', 'ideal'] — club_ideals_translations path ─────────────

    describe("with fields: ['name', 'ideal']", () => {
      const makeIdealTx = () => ({
        club_ideals_translations: {
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          upsert: jest.fn().mockResolvedValue({}),
        },
      });

      it('upserts both name and ideal columns when both are provided', async () => {
        const tx = makeIdealTx();
        await service.upsertTranslations(
          tx,
          'club_ideals_translations',
          'club_ideal_id',
          'club_ideal_id_locale',
          1,
          [{ locale: 'en', name: 'Service', ideal: 'long ideal text' }],
          ['name', 'ideal'],
        );
        expect(tx.club_ideals_translations.upsert).toHaveBeenCalledTimes(1);
        const call = tx.club_ideals_translations.upsert.mock.calls[0][0];
        expect(call.create).toMatchObject({
          club_ideal_id: 1,
          locale: 'en',
          name: 'Service',
          ideal: 'long ideal text',
        });
        expect(call.update).toMatchObject({
          name: 'Service',
          ideal: 'long ideal text',
        });
        // description must NOT be present — only fields in the override list
        expect(call.create).not.toHaveProperty('description');
      });

      it('stores empty string ideal as null (same empty-string-to-null behavior)', async () => {
        const tx = makeIdealTx();
        await service.upsertTranslations(
          tx,
          'club_ideals_translations',
          'club_ideal_id',
          'club_ideal_id_locale',
          2,
          [{ locale: 'pt-BR', name: 'Serviço', ideal: '' }],
          ['name', 'ideal'],
        );
        const call = tx.club_ideals_translations.upsert.mock.calls[0][0];
        expect(call.create.ideal).toBeNull();
        expect(call.create.name).toBe('Serviço');
      });
    });
  });
});
