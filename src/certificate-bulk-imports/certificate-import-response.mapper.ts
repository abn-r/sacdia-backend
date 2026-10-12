/**
 * HTTP-safe views of certificate import rows.
 *
 * Prisma returns `certificate_bulk_import_files.size_bytes` as `bigint`, which
 * `res.json` cannot serialize (TypeError: Do not know how to serialize a
 * BigInt). Files are capped at 10 MiB (CERTIFICATE_IMPORT_MAX_BYTES), so
 * `Number` is exact. `staging_key` is an internal storage path: it duplicates
 * `file_url` for an unconfirmed upload and no client reads it.
 *
 * Every response that carries file rows from this module goes through here
 * instead of patching `BigInt.prototype.toJSON` globally, which would also
 * change unrelated modules and hide the next BigInt column.
 */

import { TranslationService } from '../common/services/translation.service';
import {
  instructorUserSelect,
  instructorUserSelectNoPhoto,
  toInstructorView,
  type InstructorView,
} from '../instructors/instructor-view';
import type { CertificateOcrStatus } from './ocr/certificate-ocr-state';

type FileRowLike = {
  size_bytes?: bigint | null;
  staging_key?: unknown;
  page_count?: number | null;
};

export type PublicImportFile<F extends FileRowLike> = Omit<
  F,
  'size_bytes' | 'staging_key'
> &
  ('size_bytes' extends keyof F ? { size_bytes: number | null } : unknown) &
  ('page_count' extends keyof F ? { page_count: number | null } : unknown);

/**
 * `page_count` (D4) llega como número o `null` (archivo anterior a M2): el
 * cliente muestra "PDF" sin número. Una fila sin esa columna no se toca.
 */
export function toPublicImportFile<F extends FileRowLike>(
  file: F,
): PublicImportFile<F> {
  const {
    staging_key: _stagingKey,
    size_bytes: sizeBytes,
    page_count: pageCount,
    ...rest
  } = file;
  return {
    ...rest,
    ...(sizeBytes === undefined
      ? {}
      : { size_bytes: sizeBytes === null ? null : Number(sizeBytes) }),
    ...(pageCount === undefined ? {} : { page_count: pageCount ?? null }),
  } as PublicImportFile<F>;
}

export type PublicImportBatch<T extends { files?: FileRowLike[] }> = Omit<
  T,
  'files' | 'items'
> &
  (T extends { files: Array<infer F extends FileRowLike> }
    ? { files: Array<PublicImportFile<F>> }
    : unknown) &
  (T extends { items: Array<infer I> }
    ? { items: Array<PublicImportItem<I>> }
    : T extends { items?: Array<infer I> }
      ? { items?: Array<PublicImportItem<I>> }
      : unknown);

export function toPublicImportBatch<T extends { files?: FileRowLike[] }>(
  batch: T,
  locale = 'es',
  photoUrls?: ReadonlyMap<string, string | null>,
): PublicImportBatch<T> {
  const items = (batch as { items?: object[] }).items;
  // Las filas sin `honor`/`class`/`instructor` cargados no se tocan (misma referencia).
  const hasCatalog = items?.some(
    (item) => 'honor' in item || 'class' in item || 'instructor' in item,
  );
  if (batch.files === undefined && !hasCatalog) {
    return batch as unknown as PublicImportBatch<T>;
  }
  return {
    ...batch,
    ...(batch.files === undefined
      ? {}
      : { files: batch.files.map((file) => toPublicImportFile(file)) }),
    ...(hasCatalog && items
      ? {
          items: items.map((item) =>
            toPublicImportItem(item, locale, photoUrls),
          ),
        }
      : {}),
  } as unknown as PublicImportBatch<T>;
}

// ── Nombres de catálogo en las filas (inconsistencia 3 del plan) ─────────────

type NameTranslation = { locale: string; name: string | null };
type CatalogName = {
  name: string;
  translations?: NameTranslation[];
};

export type PublicHonorRef = {
  honor_id: number;
  name: string;
  category: { honor_category_id: number; name: string } | null;
};

export type PublicClassRef = {
  class_id: number;
  name: string;
  asset_code: string | null;
  club_type: { club_type_id: number; name: string } | null;
};

export type PublicImportItem<I> = Omit<I, 'honor' | 'class' | 'instructor'> &
  ('honor' extends keyof I ? { honor: PublicHonorRef | null } : unknown) &
  ('class' extends keyof I ? { class: PublicClassRef | null } : unknown) &
  ('instructor' extends keyof I
    ? { instructor: InstructorView | null }
    : unknown);

/** El overlay de traducciones es puro; no hace falta inyectarlo. */
const translator = new TranslationService();

export function localizedName<T extends CatalogName>(
  record: T,
  locale: string,
): string {
  return translator.translate(
    { name: record.name },
    (record.translations ?? []).map((row) => ({
      locale: row.locale,
      ...(row.name == null ? {} : { name: row.name }),
    })),
    locale,
    ['name'],
  ).name;
}

/**
 * `include` de `honor`, `class` e `instructor` para las filas del lote. Trae
 * categoría y tipo de club, con las traducciones del idioma pedido (`es` vive
 * en la tabla principal y no necesita traducción). El instructor nunca trae
 * correo; `user_image` solo se pide donde la respuesta firma la foto (miembro).
 */
export function catalogItemInclude(locale = 'es', withInstructorPhoto = false) {
  const translations = {
    where: { locale },
    select: { locale: true, name: true },
  };
  return {
    instructor: {
      select: withInstructorPhoto
        ? instructorUserSelect
        : instructorUserSelectNoPhoto,
    },
    honor: {
      select: {
        honor_id: true,
        name: true,
        translations,
        honors_categories: {
          select: { honor_category_id: true, name: true, translations },
        },
      },
    },
    class: {
      select: {
        class_id: true,
        name: true,
        asset_code: true,
        translations,
        club_types: {
          select: { club_type_id: true, name: true, translations },
        },
      },
    },
  };
}

/**
 * Aplana `honor` y `class` a `{ honor: {…, category}, class: {…, club_type} }`
 * con nombres traducidos y reemplaza la relación `instructor` por su bloque
 * público. Una fila sin esas relaciones cargadas queda igual.
 */
export function toPublicImportItem<I extends object>(
  item: I,
  locale = 'es',
  photoUrls?: ReadonlyMap<string, string | null>,
): PublicImportItem<I> {
  const row = item as Record<string, unknown>;
  const out: Record<string, unknown> = { ...row };
  if ('instructor' in row) {
    out.instructor = toInstructorView(row, photoUrls);
  }
  if ('honor' in row) {
    const honor = row.honor as
      | (CatalogName & {
          honor_id: number;
          honors_categories?:
            (CatalogName & { honor_category_id: number }) | null;
        })
      | null
      | undefined;
    out.honor = honor
      ? {
          honor_id: honor.honor_id,
          name: localizedName(honor, locale),
          category: honor.honors_categories
            ? {
                honor_category_id: honor.honors_categories.honor_category_id,
                name: localizedName(honor.honors_categories, locale),
              }
            : null,
        }
      : null;
  }
  if ('class' in row) {
    const klass = row.class as
      | (CatalogName & {
          class_id: number;
          asset_code?: string | null;
          club_types?: (CatalogName & { club_type_id: number }) | null;
        })
      | null
      | undefined;
    out.class = klass
      ? {
          class_id: klass.class_id,
          name: localizedName(klass, locale),
          asset_code: klass.asset_code ?? null,
          club_type: klass.club_types
            ? {
                club_type_id: klass.club_types.club_type_id,
                name: localizedName(klass.club_types, locale),
              }
            : null,
        }
      : null;
  }
  return out as PublicImportItem<I>;
}

// ── Estado de lectura del OCR (D3) ───────────────────────────────────────────

/**
 * Agrega `ocr_state` y `ocr_error_code` ya resueltos (el mapper nunca consulta
 * Redis). `undefined` (no se pudo determinar) omite ambas claves: el cliente lo
 * trata como "sin dato", distinto de `ocr_state: null` ("nunca se pidió OCR").
 */
export function withOcrState<T extends object>(
  batch: T,
  status: CertificateOcrStatus | undefined,
): T & Partial<CertificateOcrStatus> {
  return status === undefined ? batch : { ...batch, ...status };
}
