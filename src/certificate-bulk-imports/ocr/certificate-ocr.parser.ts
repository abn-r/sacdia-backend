import { CertificateBulkImportItemType } from '../certificate-bulk-imports.types';

export interface CertificateOcrCandidate {
  type: CertificateBulkImportItemType;
  detectedName: string;
  completedAt?: string;
  confidence: number;
  fieldConfidence: Record<string, number>;
}

export interface CertificateOcrParseResult {
  rawText: string;
  items: CertificateOcrCandidate[];
}

const HONOR_LABEL_REGEX = /(?:especialidad(?:es)?|honores?)\s*:\s*([^\n]+)/gi;
const CLASS_LABEL_REGEX = /(?:clase|investidura)\s*:\s*([^\n]+)/gi;

export class CertificateOcrParser {
  parse(rawText: string): CertificateOcrParseResult {
    const normalizedText = this.normalizeWhitespace(rawText);
    const completedAt = this.extractDate(normalizedText);
    const items: CertificateOcrCandidate[] = [
      ...this.extractItems(
        normalizedText,
        HONOR_LABEL_REGEX,
        CertificateBulkImportItemType.HONOR,
        completedAt,
      ),
      ...this.extractItems(
        normalizedText,
        CLASS_LABEL_REGEX,
        CertificateBulkImportItemType.CLASS,
        completedAt,
      ),
    ];

    return {
      rawText: normalizedText,
      items,
    };
  }

  private extractItems(
    text: string,
    labelRegex: RegExp,
    type: CertificateBulkImportItemType,
    completedAt?: string,
  ): CertificateOcrCandidate[] {
    const matches = [...text.matchAll(labelRegex)];

    return matches.flatMap((match) =>
      this.splitNames(match[1]).map((detectedName) => ({
        type,
        detectedName,
        completedAt,
        confidence: completedAt ? 0.72 : 0.48,
        fieldConfidence: {
          type: 0.8,
          name: 0.7,
          date: completedAt ? 0.7 : 0,
        },
      })),
    );
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
