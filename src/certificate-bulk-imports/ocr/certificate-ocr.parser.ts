import { checkDateInRange } from '../../common/utils/honor-date-range';
import { CertificateBulkImportItemType } from '../certificate-bulk-imports.types';

export interface CertificateOcrCandidate {
  type: CertificateBulkImportItemType;
  detectedName: string;
  /** Fecha válida (D6: 1960-01-01 a hoy). Fuera de rango queda vacía. */
  completedAt?: string;
  /** Fecha cruda que leyó el OCR. Solo se llena cuando quedó fuera de rango. */
  detectedDate?: string;
  confidence: number;
  fieldConfidence: Record<string, number>;
  /** Archivo del lote donde se leyó la fila (D12). Ausente si el parser no lo sabe. */
  sourceFileId?: string;
  /** Página (1 a 5) DENTRO de `sourceFileId` (D4). Siempre junto a `sourceFileId`. */
  sourcePage?: number;
}

export interface CertificateOcrPage {
  pageNumber: number;
  text: string;
}

/** Texto de un archivo del lote, página por página (imagen = una sola página). */
export interface CertificateOcrFileText {
  fileId: string | null;
  pages: CertificateOcrPage[];
}

export interface CertificateOcrParseResult {
  rawText: string;
  items: CertificateOcrCandidate[];
  /** Texto por archivo y página tal como lo leyó el proveedor. No se persiste. */
  files: CertificateOcrFileText[];
}

// Las etiquetas van al inicio de la línea (con espacios o viñetas antes). Sin el
// ancla, "Fecha de investidura: 15/10/2021" se leía como una clase llamada
// "15/10/2021".
const HONOR_LABEL_REGEX =
  /^[ \t•·*-]*(?:especialidad(?:es)?|honor(?:es)?)\s*:\s*([^\n]+)/gim;
const CLASS_LABEL_REGEX = /^[ \t•·*-]*(?:clase|investidura)\s*:\s*([^\n]+)/gim;
const DATE_REGEX =
  /\b(?:(19\d{2}|20\d{2})[-/](\d{1,2})[-/](\d{1,2})|(\d{1,2})[-/](\d{1,2})[-/](19\d{2}|20\d{2}))\b/g;
/** A trailing date in a candidate value, with the dash or parentheses around it. */
const INLINE_DATE_REGEX =
  /\s*[-–—(]*\s*\b(?:(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/](?:19|20)\d{2})\b\s*\)?\s*$/;

/**
 * Confianza de la fecha según de dónde salió (el umbral de la app es 0.8, D5):
 * - `own`: la fecha que sigue a la etiqueta del candidato, antes de la siguiente.
 * - `page`: una fecha de la misma página que no le sigue (la previa más cercana o
 *   la primera de la página).
 * - `fallback`: la del archivo o la del lote.
 */
const OWN_DATE_CONFIDENCE = 0.85;
const PAGE_DATE_CONFIDENCE = 0.7;
const FALLBACK_DATE_CONFIDENCE = 0.5;

type DateSource = 'own' | 'page' | 'fallback';
type PageDate = { index: number; value: string };
type ParsedPage = {
  fileId: string | null;
  pageNumber: number;
  /** Clave de ubicación: dos candidatos iguales en la misma no se deduplican. */
  location: string;
  text: string;
  /** Fechas de la página con su posición en `text`. */
  dates: PageDate[];
  /** Fecha del archivo o, si no la tiene, la del lote. */
  fallbackDate?: string;
};

export class CertificateOcrParser {
  /** Texto plano sin ubicación (sin archivo ni página). */
  parse(rawText: string): CertificateOcrParseResult {
    return this.parseFiles([
      { fileId: null, pages: [{ pageNumber: 1, text: rawText }] },
    ]);
  }

  /**
   * Extrae candidatos por archivo y por página (§4.7).
   * - La fecha de un candidato es la más cercana después de su etiqueta y antes
   *   de la siguiente etiqueta; si no hay, la previa más cercana de la página; si
   *   no, la primera de la página; si la página no tiene, la primera del archivo
   *   y, si el archivo tampoco, la primera del lote. En los dos últimos
   *   respaldos la confianza baja.
   * - Un mismo candidato en varias páginas o archivos se conserva una vez: el del
   *   primer archivo (orden de subida) y, dentro de él, el de la primera página.
   */
  parseFiles(files: CertificateOcrFileText[]): CertificateOcrParseResult {
    const fileTexts = files.map((file) => ({
      fileId: file.fileId,
      pages: [...file.pages].sort((a, b) => a.pageNumber - b.pageNumber),
    }));
    const joined = (texts: string[]) =>
      texts.filter((t) => t.trim()).join('\n');
    const fileJoined = fileTexts.map((file) =>
      this.normalizeWhitespace(file.pages.map((page) => page.text).join('\n')),
    );
    const rawText = this.normalizeWhitespace(
      joined(
        fileTexts.map((file) => file.pages.map((page) => page.text).join('\n')),
      ),
    );
    const batchDate = this.extractDate(rawText);

    const pages: ParsedPage[] = fileTexts.flatMap((file, fileIndex) => {
      const fileDate = this.extractDate(fileJoined[fileIndex]);
      return file.pages.map((page): ParsedPage => {
        const text = this.normalizeWhitespace(page.text);
        return {
          fileId: file.fileId,
          pageNumber: page.pageNumber,
          location: `${fileIndex}:${page.pageNumber}`,
          text,
          dates: this.findDates(text),
          fallbackDate: fileDate ?? batchDate,
        };
      });
    });

    const seen = new Map<string, string>();
    const items: CertificateOcrCandidate[] = [
      ...this.extractItems(
        pages,
        HONOR_LABEL_REGEX,
        CertificateBulkImportItemType.HONOR,
        seen,
      ),
      ...this.extractItems(
        pages,
        CLASS_LABEL_REGEX,
        CertificateBulkImportItemType.CLASS,
        seen,
      ),
    ];

    return {
      rawText,
      items: items.map((item) => this.tagInstitutional(item)),
      files: fileTexts,
    };
  }

  private tagInstitutional(
    item: CertificateOcrCandidate,
  ): CertificateOcrCandidate {
    if (
      !/gu[ií]a\s+mayor\s+avanzad|^\s*instructor\s*$|\bgm-0?2\b|\bgm-0?3\b/i.test(
        item.detectedName,
      )
    ) {
      return item;
    }
    return {
      ...item,
      fieldConfidence: { ...item.fieldConfidence, institutional: 1 },
    };
  }

  private extractItems(
    pages: ParsedPage[],
    labelRegex: RegExp,
    type: CertificateBulkImportItemType,
    seen: Map<string, string>,
  ): CertificateOcrCandidate[] {
    return pages.flatMap((page) => {
      // Inicio de toda etiqueta de candidato (especialidad, honor, clase) de la
      // página: una fecha no pasa de la siguiente etiqueta.
      const labelStarts = [HONOR_LABEL_REGEX, CLASS_LABEL_REGEX]
        .flatMap((regex) => [...page.text.matchAll(regex)])
        .map((match) => match.index ?? 0);

      return [...page.text.matchAll(labelRegex)].flatMap((match) => {
        const start = match.index ?? 0;
        const nextLabel = Math.min(
          Infinity,
          ...labelStarts.filter((position) => position > start),
        );
        const { value: rawDate, source } = this.pickDate(
          page,
          start,
          nextLabel,
        );
        // D6: una lectura como "1925" por "2025" no pasa como fecha válida. Se
        // conserva cruda en `detectedDate` y la fila nace sin `completedAt`.
        const dateIssue = rawDate ? checkDateInRange(rawDate) : null;
        const completedAt = rawDate && dateIssue === null ? rawDate : undefined;
        const detectedDate =
          dateIssue === 'TOO_OLD' || dateIssue === 'IN_FUTURE'
            ? rawDate
            : undefined;
        const dateConfidence = {
          own: OWN_DATE_CONFIDENCE,
          page: PAGE_DATE_CONFIDENCE,
          fallback: FALLBACK_DATE_CONFIDENCE,
        }[source];

        return this.splitNames(match[1])
          .filter((detectedName) => this.looksLikeName(detectedName))
          .flatMap((detectedName) => {
            const key = `${type}|${this.identity(detectedName)}`;
            const firstSeenAt = seen.get(key);
            if (firstSeenAt !== undefined && firstSeenAt !== page.location) {
              return [];
            }
            seen.set(key, page.location);
            return [
              {
                type,
                detectedName,
                completedAt,
                ...(detectedDate ? { detectedDate } : {}),
                confidence: completedAt
                  ? source === 'own'
                    ? 0.8
                    : source === 'page'
                      ? 0.72
                      : 0.6
                  : 0.48,
                fieldConfidence: {
                  type: 0.8,
                  name: 0.7,
                  date: completedAt ? dateConfidence : 0,
                },
                ...(page.fileId
                  ? { sourceFileId: page.fileId, sourcePage: page.pageNumber }
                  : {}),
              },
            ];
          });
      });
    });
  }

  /**
   * Fecha de un candidato cuya etiqueta empieza en `start`: la más cercana
   * después de ella y antes de la siguiente etiqueta; si no hay, la previa más
   * cercana de la página; si no, la primera de la página; si no, el respaldo del
   * archivo o del lote.
   */
  private pickDate(
    page: ParsedPage,
    start: number,
    nextLabel: number,
  ): { value?: string; source: DateSource } {
    const own = page.dates.find(
      (date) => date.index >= start && date.index < nextLabel,
    );
    if (own) {
      return { value: own.value, source: 'own' };
    }
    const previous = [...page.dates]
      .reverse()
      .find((date) => date.index < start);
    if (previous) {
      return { value: previous.value, source: 'page' };
    }
    if (page.dates.length > 0) {
      return { value: page.dates[0].value, source: 'page' };
    }
    return { value: page.fallbackDate, source: 'fallback' };
  }

  /** Un nombre sin letras (por ejemplo, solo una fecha) no es un candidato. */
  private looksLikeName(name: string): boolean {
    return /\p{L}/u.test(name.replace(new RegExp(DATE_REGEX), ''));
  }

  /** Nombre sin mayúsculas, tildes ni espacios repetidos, para detectar el mismo candidato. */
  private identity(name: string): string {
    return name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private splitNames(rawValue: string): string[] {
    return rawValue
      .split(/,|;/)
      .map((value) =>
        value
          .replace(/\bfecha\b\s*:.+$/i, '')
          .replace(/\bcompletad[ao]\b\s*:.+$/i, '')
          // A date on the same line ("Alfabetización 12/09/2026",
          // "Amigo (15/10/2021)") is the completion date, already read by
          // pickDate. Keep it out of the name, with its separators.
          .replace(INLINE_DATE_REGEX, '')
          .trim(),
      )
      .filter(Boolean);
  }

  /** Fechas del texto en orden de aparición, con su posición. */
  private findDates(text: string): PageDate[] {
    return [...text.matchAll(DATE_REGEX)].map((match) => ({
      index: match.index ?? 0,
      value: match[1]
        ? this.toIsoDate(match[1], match[2], match[3])
        : this.toIsoDate(match[6], match[5], match[4]),
    }));
  }

  private extractDate(text: string): string | undefined {
    return this.findDates(text)[0]?.value;
  }

  private toIsoDate(year: string, month: string, day: string): string {
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  private normalizeWhitespace(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/[ ]{2,}/g, ' ')
      .trim();
  }
}
