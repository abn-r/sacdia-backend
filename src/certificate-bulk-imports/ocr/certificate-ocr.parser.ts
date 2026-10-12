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

const HONOR_LABEL_REGEX =
  /(?:especialidad(?:es)?|honor(?:es)?)\s*:\s*([^\n]+)/gi;
const CLASS_LABEL_REGEX = /(?:clase|investidura)\s*:\s*([^\n]+)/gi;

/** Confianza de la fecha cuando viene de la propia página y cuando es un respaldo. */
const PAGE_DATE_CONFIDENCE = 0.7;
const FALLBACK_DATE_CONFIDENCE = 0.5;

type DateSource = 'page' | 'file' | 'batch';
type ParsedPage = {
  fileId: string | null;
  pageNumber: number;
  /** Clave de ubicación: dos candidatos iguales en la misma no se deduplican. */
  location: string;
  text: string;
  date?: { value: string; source: DateSource };
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
   * - La fecha de un candidato es la de su página; si la página no tiene, la
   *   primera del archivo; si el archivo tampoco, la primera del lote (el
   *   comportamiento anterior). En los dos respaldos la confianza baja.
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
        const own = this.extractDate(text);
        const fallback = fileDate
          ? { value: fileDate, source: 'file' as const }
          : batchDate
            ? { value: batchDate, source: 'batch' as const }
            : undefined;
        return {
          fileId: file.fileId,
          pageNumber: page.pageNumber,
          location: `${fileIndex}:${page.pageNumber}`,
          text,
          date: own ? { value: own, source: 'page' } : fallback,
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
      // D6: una lectura como "1925" por "2025" no pasa como fecha válida. Se
      // conserva cruda en `detectedDate` y la fila nace sin `completedAt`.
      const rawDate = page.date?.value;
      const dateIssue = rawDate ? checkDateInRange(rawDate) : null;
      const completedAt = rawDate && dateIssue === null ? rawDate : undefined;
      const detectedDate =
        dateIssue === 'TOO_OLD' || dateIssue === 'IN_FUTURE'
          ? rawDate
          : undefined;
      const dateConfidence =
        page.date?.source === 'page'
          ? PAGE_DATE_CONFIDENCE
          : FALLBACK_DATE_CONFIDENCE;

      return [...page.text.matchAll(labelRegex)].flatMap((match) =>
        this.splitNames(match[1]).flatMap((detectedName) => {
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
                ? dateConfidence === PAGE_DATE_CONFIDENCE
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
        }),
      );
    });
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
          .trim(),
      )
      .filter(Boolean);
  }

  private extractDate(text: string): string | undefined {
    const isoLike = text.match(
      /\b(19\d{2}|20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/,
    );
    if (isoLike) {
      return this.toIsoDate(isoLike[1], isoLike[2], isoLike[3]);
    }

    const dayFirst = text.match(
      /\b(\d{1,2})[-/](\d{1,2})[-/](19\d{2}|20\d{2})\b/,
    );
    if (dayFirst) {
      return this.toIsoDate(dayFirst[3], dayFirst[2], dayFirst[1]);
    }

    return undefined;
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
