import { Test, TestingModule } from '@nestjs/testing';
import { TranslationService } from './translation.service';
import { I18nContext } from 'nestjs-i18n';

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
      const result = service.translate(
        spanishRecord,
        translations,
        'es',
        ['name', 'description'],
      );
      expect(result).toEqual(spanishRecord);
      // Ensure it is the same object reference (no copy created for es)
      expect(result).toBe(spanishRecord);
    });

    it('overlays fields when translation exists for the requested locale', () => {
      const translations = [
        { locale: 'en', name: 'ADRA EN', description: 'ADRA activities EN' },
      ];
      const result = service.translate(
        spanishRecord,
        translations,
        'en',
        ['name', 'description'],
      );
      expect(result.name).toBe('ADRA EN');
      expect(result.description).toBe('ADRA activities EN');
      expect(result.honor_category_id).toBe(1); // non-translated field preserved
    });

    it('returns record unchanged when no translation exists for the locale', () => {
      const translations: Array<Partial<Category> & { locale: string }> = [];
      const result = service.translate(
        spanishRecord,
        translations,
        'fr',
        ['name', 'description'],
      );
      expect(result).toEqual(spanishRecord);
    });

    it('only overlays fields with non-null values from translation', () => {
      // Translation has name but null description — description should keep Spanish value.
      const translations = [
        { locale: 'pt-BR', name: 'ADRA PT', description: null },
      ];
      const result = service.translate(
        spanishRecord,
        translations,
        'pt-BR',
        ['name', 'description'],
      );
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
});
