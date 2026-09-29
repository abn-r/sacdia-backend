import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type CertificateImportYearBlocker = {
  code:
    | 'CERTIFICATE_IMPORT_DATE_REQUIRED'
    | 'CERTIFICATE_IMPORT_YEAR_NOT_FOUND'
    | 'CERTIFICATE_IMPORT_YEAR_AMBIGUOUS';
};

export type CertificateImportYearRow = {
  year_id: number;
  start_date?: Date | null;
  end_date?: Date | null;
  active?: boolean | null;
};

export type CertificateImportYearResolution =
  | {
      status: 'resolved';
      yearId: number;
      active: boolean;
      civilDate: string;
    }
  | {
      status: 'missing';
      code: 'CERTIFICATE_IMPORT_YEAR_NOT_FOUND';
      civilDate: string;
    }
  | {
      status: 'ambiguous';
      code: 'CERTIFICATE_IMPORT_YEAR_AMBIGUOUS';
      civilDate: string;
      yearIds: number[];
    };

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function utcCivilDate(civilDate: string): Date {
  const match = CIVIL_DATE.exec(civilDate);
  if (!match) {
    throw new Error('CERTIFICATE_IMPORT_DATE_INVALID');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('CERTIFICATE_IMPORT_DATE_INVALID');
  }
  return date;
}

export function civilDateFromDbDate(
  value: Date | string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    const match = CIVIL_DATE.exec(value.slice(0, 10));
    return match ? match[0] : null;
  }
  if (Number.isNaN(value.getTime())) {
    return null;
  }
  return value.toISOString().slice(0, 10);
}

function coversCivilDate(
  year: CertificateImportYearRow,
  civilDate: string,
): boolean {
  if (!year.start_date || !year.end_date) {
    return true;
  }
  const start = civilDateFromDbDate(year.start_date);
  const end = civilDateFromDbDate(year.end_date);
  if (!start || !end) {
    return false;
  }
  return start <= civilDate && end >= civilDate;
}

export function classifyCertificateImportYear(
  civilDate: string,
  years: CertificateImportYearRow[],
): CertificateImportYearResolution {
  const covering = years.filter((year) => coversCivilDate(year, civilDate));
  if (covering.length === 0) {
    return {
      status: 'missing',
      code: 'CERTIFICATE_IMPORT_YEAR_NOT_FOUND',
      civilDate,
    };
  }
  if (covering.length > 1) {
    return {
      status: 'ambiguous',
      code: 'CERTIFICATE_IMPORT_YEAR_AMBIGUOUS',
      civilDate,
      yearIds: covering.map((year) => year.year_id),
    };
  }
  return {
    status: 'resolved',
    yearId: covering[0].year_id,
    active: covering[0].active ?? false,
    civilDate,
  };
}

export function blockersForClassCertificate(params: {
  itemType: string;
  completedAt: Date | string | null | undefined;
  years: CertificateImportYearRow[];
}): CertificateImportYearBlocker[] {
  if (params.itemType !== 'CLASS') {
    return [];
  }
  const civilDate = civilDateFromDbDate(params.completedAt);
  if (!civilDate) {
    return [{ code: 'CERTIFICATE_IMPORT_DATE_REQUIRED' }];
  }
  const resolution = classifyCertificateImportYear(civilDate, params.years);
  if (resolution.status === 'resolved') {
    return [];
  }
  return [{ code: resolution.code }];
}

type ClassCertificateItem = {
  item_id: string;
  item_type: string;
  completed_at?: Date | string | null;
};

@Injectable()
export class CertificateImportYearResolver {
  constructor(private readonly prisma: PrismaService) {}

  async blockersForItems(
    items: ClassCertificateItem[],
  ): Promise<Map<string, CertificateImportYearBlocker[]>> {
    const classItems = items.filter((item) => item.item_type === 'CLASS');
    const years =
      classItems.length === 0
        ? []
        : await this.prisma.ecclesiastical_years.findMany({
            select: {
              year_id: true,
              start_date: true,
              end_date: true,
              active: true,
            },
          });

    return new Map(
      items.map((item) => [
        item.item_id,
        blockersForClassCertificate({
          itemType: item.item_type,
          completedAt: item.completed_at,
          years,
        }),
      ]),
    );
  }
}
