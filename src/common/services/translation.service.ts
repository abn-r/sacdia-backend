import { Injectable } from '@nestjs/common';
import { I18nContext } from 'nestjs-i18n';
import { AppBadRequestException } from '../errors/app.exception';
import { ErrorCode } from '../errors/error-codes';

/**
 * TranslationService — Approach X i18n helper.
 *
 * Spanish (`es`) STAYS in main table columns; this service overlays non-es
 * translations from the `<entity>_translations` join tables at runtime.
 *
 * No DB calls — pure transformation logic.
 */
@Injectable()
export class TranslationService {
  /**
   * Returns the current request locale from I18nContext.
   * Falls back to 'es' if no context is active (e.g., background jobs).
   */
  getCurrentLocale(): string {
    return I18nContext.current()?.lang ?? 'es';
  }

  /**
   * Overlays translated fields onto a single record.
   *
   * - If locale is 'es': return record unchanged (Spanish is already in main table).
   * - If a translation row exists for the locale: overlay only fields that have
   *   a non-null value in the translation row.
   * - If no translation row exists for the locale: return record unchanged
   *   (fallback to Spanish in main table).
   *
   * @param record        The main-table record.
   * @param translations  Array of translation rows (already filtered by locale
   *                      in the Prisma query, so 0 or 1 element expected).
   * @param locale        The target locale string (e.g., 'en', 'pt-BR').
   * @param fields        The field names to overlay from the translation row.
   * @returns             Record with translated fields applied, or original if no translation.
   */
  translate<T extends object, K extends keyof T>(
    record: T,
    translations: Array<Partial<T> & { locale: string }>,
    locale: string,
    fields: K[],
  ): T {
    if (locale === 'es') {
      return record;
    }

    const translation = translations.find((t) => t.locale === locale);
    if (!translation) {
      return record;
    }

    const overrides: Partial<T> = {};
    for (const field of fields) {
      const value = translation[field];
      // Only overlay when the translation has a non-null, non-undefined value.
      if (value !== null && value !== undefined) {
        overrides[field] = value as T[K];
      }
    }

    return { ...record, ...overrides };
  }

  // ── WRITE HELPERS ─────────────────────────────────────────────────────────

  /**
   * Validate a translations array from a write DTO.
   *
   * Throws AppBadRequestException on:
   *   - locale === 'es'                       → TRANSLATIONS_ES_NOT_ALLOWED
   *   - locale not in ['pt-BR','en','fr']     → TRANSLATIONS_INVALID_LOCALE
   *   - duplicate locale in the array         → TRANSLATIONS_DUPLICATE_LOCALE
   *
   * Safe to call with undefined (no-op) — useful before entering a transaction.
   */
  validateTranslations(
    translations?: Array<{
      locale: string;
      name?: string;
      description?: string;
    }>,
  ): void {
    if (!translations) return;
    const seen = new Set<string>();
    for (const t of translations) {
      if (t.locale === 'es') {
        throw new AppBadRequestException(ErrorCode.TRANSLATIONS_ES_NOT_ALLOWED);
      }
      if (!['pt-BR', 'en', 'fr'].includes(t.locale)) {
        throw new AppBadRequestException(
          ErrorCode.TRANSLATIONS_INVALID_LOCALE,
          { locale: t.locale },
        );
      }
      if (seen.has(t.locale)) {
        throw new AppBadRequestException(
          ErrorCode.TRANSLATIONS_DUPLICATE_LOCALE,
          { locale: t.locale },
        );
      }
      seen.add(t.locale);
    }
  }

  /**
   * Upsert or delete translation rows for a given parent record inside a
   * Prisma transaction.
   *
   * Behavior:
   *   - translations === undefined  → no-op (leave existing rows untouched)
   *   - translations === []         → delete all rows for this recordId
   *   - translations has entries    → upsert each row by (recordId, locale);
   *                                   empty/undefined string values stored as NULL
   *                                   so READ helper falls back to Spanish.
   *
   * @param tx                Prisma transaction client (typed as any to avoid
   *                          circular dependency on generated client types).
   * @param translationModel  Prisma model name, e.g. 'honors_categories_translations'.
   * @param recordIdField     FK column name on the translation model, e.g. 'honor_category_id'.
   * @param uniqueIndexName   Name of the compound unique index used in the upsert
   *                          `where` clause, e.g. 'honor_category_id_locale'.
   * @param recordId          PK of the parent record.
   * @param translations      Array from the DTO (already validated via validateTranslations).
   * @param fields            Translatable fields to read from each translation entry.
   */
  async upsertTranslations(
    tx: any,
    translationModel: string,
    recordIdField: string,
    uniqueIndexName: string,
    recordId: number | string,
    translations:
      | Array<{ locale: string; name?: string; description?: string }>
      | undefined,
    fields: ('name' | 'description')[] = ['name', 'description'],
  ): Promise<void> {
    if (translations === undefined) return;

    if (translations.length === 0) {
      await tx[translationModel].deleteMany({
        where: { [recordIdField]: recordId },
      });
      return;
    }

    for (const t of translations) {
      const data: Record<string, string | null | Date> = {};
      for (const f of fields) {
        const v = t[f as keyof typeof t];
        data[f] = v === '' || v === undefined || v === null ? null : v;
      }

      await tx[translationModel].upsert({
        where: {
          [uniqueIndexName]: { [recordIdField]: recordId, locale: t.locale },
        },
        create: { [recordIdField]: recordId, locale: t.locale, ...data },
        update: { ...data, updated_at: new Date() },
      });
    }
  }

  // ── READ HELPERS ──────────────────────────────────────────────────────────

  /**
   * Applies translate() to every record in a list and strips the internal
   * translations array from the output.
   *
   * Each record must carry its translations array under `translationsKey`
   * (populated by the Prisma `include`/`select` clause in the calling service).
   *
   * @param records          Array of main-table records with embedded translations.
   * @param locale           The target locale string.
   * @param fields           The field names to overlay from translation rows.
   * @param translationsKey  The key on each record that holds its translations array.
   * @returns                Array of records with translated fields and no translations key.
   */
  translateMany<T extends object, TKey extends keyof T>(
    records: T[],
    locale: string,
    fields: string[],
    translationsKey: TKey,
  ): Array<Omit<T, TKey>> {
    return records.map((record) => {
      const translations =
        (record[translationsKey] as Array<Partial<T> & { locale: string }>) ??
        [];

      const translated = this.translate(
        record,
        translations,
        locale,
        fields as Array<keyof T>,
      );

      // Strip the translations array — callers receive a clean DTO.
      const { [translationsKey]: _dropped, ...rest } = translated as T &
        Record<TKey, unknown>;

      return rest as Omit<T, TKey>;
    });
  }
}
