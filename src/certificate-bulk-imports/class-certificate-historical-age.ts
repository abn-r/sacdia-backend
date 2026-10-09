import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ClassAssignmentResolverService } from '../common/services/class-assignment-resolver.service';
import {
  canTakeAdvisoryLocks,
  lockInvestitureAuthorizationYear,
} from '../investiture-requests/investiture-request-lock';
import {
  CertificateImportYearRow,
  civilDateFromDbDate,
  classifyCertificateImportYear,
  utcCivilDate,
} from './certificate-import-year-resolver.service';

const ageAtEcclesiasticalYearStart = new ClassAssignmentResolverService();

export type HistoricalAgeSuccess = {
  yearId: number;
  age: number;
  minimumAge: number;
};

export type HistoricalAgeDb = {
  users: {
    findUnique: (args: {
      where: { user_id: string };
      select: { birthday: true };
    }) => Promise<{ birthday: Date | string | null } | null>;
  };
  classes: {
    findUnique: (args: {
      where: { class_id: number };
      select: { minimum_age: true };
    }) => Promise<{ minimum_age: number | null } | null>;
  };
  ecclesiastical_years: {
    findMany: (args: {
      where?: {
        start_date?: { lte: Date };
        end_date?: { gte: Date };
      };
      select: {
        year_id: true;
        start_date: true;
        end_date: true;
        active: true;
      };
    }) => Promise<CertificateImportYearRow[]>;
  };
  $queryRawUnsafe?: (query: string, ...values: unknown[]) => Promise<unknown>;
};

export function evaluateClassCertificateHistoricalAge(input: {
  completedAt: Date | string | null | undefined;
  birthday: Date | string | null | undefined;
  minimumAge: number | null | undefined;
  years: CertificateImportYearRow[];
}): HistoricalAgeSuccess {
  const civilDate = civilDateFromDbDate(input.completedAt);
  if (!civilDate) {
    throw new AppBadRequestException(
      ErrorCode.CERTIFICATE_IMPORT_DATE_REQUIRED,
    );
  }

  const birthday = civilDateFromDbDate(input.birthday);
  if (!birthday) {
    throw new AppBadRequestException(
      ErrorCode.CERTIFICATE_IMPORT_BIRTHDAY_REQUIRED,
    );
  }

  if (
    input.minimumAge == null ||
    !Number.isInteger(input.minimumAge) ||
    input.minimumAge < 0
  ) {
    throw new AppBadRequestException(
      ErrorCode.CERTIFICATE_IMPORT_CLASS_MINIMUM_AGE_REQUIRED,
    );
  }

  const resolution = classifyCertificateImportYear(civilDate, input.years);
  if (resolution.status === 'missing') {
    throw new AppBadRequestException(
      ErrorCode.CERTIFICATE_IMPORT_YEAR_NOT_FOUND,
    );
  }
  if (resolution.status === 'ambiguous') {
    throw new AppBadRequestException(
      ErrorCode.CERTIFICATE_IMPORT_YEAR_AMBIGUOUS,
    );
  }

  const year = input.years.find((row) => row.year_id === resolution.yearId);
  const yearStart = year?.start_date
    ? civilDateFromDbDate(year.start_date)
    : null;
  if (!yearStart) {
    throw new AppBadRequestException(
      ErrorCode.CERTIFICATE_IMPORT_YEAR_NOT_FOUND,
    );
  }

  const age = ageAtEcclesiasticalYearStart.ageAtDate(
    utcCivilDate(birthday),
    utcCivilDate(yearStart),
  );
  if (age < input.minimumAge) {
    throw new AppBadRequestException(
      ErrorCode.CERTIFICATE_IMPORT_AGE_BELOW_MINIMUM,
      {
        age,
        minimumAge: input.minimumAge,
      },
    );
  }

  return {
    yearId: resolution.yearId,
    age,
    minimumAge: input.minimumAge,
  };
}

const HISTORICAL_GATE_CODES = new Set<string>([
  ErrorCode.CERTIFICATE_IMPORT_DATE_REQUIRED,
  ErrorCode.CERTIFICATE_IMPORT_YEAR_NOT_FOUND,
  ErrorCode.CERTIFICATE_IMPORT_YEAR_AMBIGUOUS,
  ErrorCode.CERTIFICATE_IMPORT_BIRTHDAY_REQUIRED,
  ErrorCode.CERTIFICATE_IMPORT_CLASS_MINIMUM_AGE_REQUIRED,
  ErrorCode.CERTIFICATE_IMPORT_AGE_BELOW_MINIMUM,
  ErrorCode.CERTIFICATE_IMPORT_CATALOG_NOT_FOUND,
]);

export function isCertificateHistoricalGateError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    HISTORICAL_GATE_CODES.has(String((error as { code?: unknown }).code))
  );
}

export type CertificateYearLockOptions = {
  /** El llamador ya tomó estos años en orden ascendente. */
  skipYearAdvisory?: boolean;
};

export async function ecclesiasticalYearIdsCovering(
  db: HistoricalAgeDb,
  dates: ReadonlyArray<Date | string | null | undefined>,
): Promise<number[]> {
  const yearIds = new Set<number>();
  for (const completedAt of dates) {
    const civilDate = civilDateFromDbDate(completedAt);
    if (!civilDate) continue;
    const rows = await db.ecclesiastical_years.findMany({
      where: {
        start_date: { lte: utcCivilDate(civilDate) },
        end_date: { gte: utcCivilDate(civilDate) },
      },
      select: {
        year_id: true,
        start_date: true,
        end_date: true,
        active: true,
      },
    });
    for (const row of rows) yearIds.add(row.year_id);
  }
  return [...yearIds].sort((left, right) => left - right);
}

export async function lockInvestitureYearsAscending(
  db: HistoricalAgeDb,
  yearIds: readonly number[],
): Promise<void> {
  if (!canTakeAdvisoryLocks(db)) return;
  const sorted = [...new Set(yearIds)].sort((left, right) => left - right);
  for (const yearId of sorted) {
    await lockInvestitureAuthorizationYear(db, yearId);
  }
}

export async function assertClassCertificateHistoricalAge(
  db: HistoricalAgeDb,
  params: {
    userId: string;
    classId: number;
    completedAt: Date | string | null | undefined;
  },
  options?: CertificateYearLockOptions,
): Promise<HistoricalAgeSuccess> {
  const civilDate = civilDateFromDbDate(params.completedAt);
  if (!options?.skipYearAdvisory) {
    await lockInvestitureYearsAscending(
      db,
      await ecclesiasticalYearIdsCovering(db, [params.completedAt]),
    );
  }
  if (typeof db.$queryRawUnsafe === 'function') {
    await db.$queryRawUnsafe(
      'SELECT user_id FROM users WHERE user_id = $1::uuid FOR SHARE',
      params.userId,
    );
    await db.$queryRawUnsafe(
      'SELECT class_id FROM classes WHERE class_id = $1 FOR SHARE',
      params.classId,
    );
    if (civilDate) {
      await db.$queryRawUnsafe(
        `SELECT year_id FROM ecclesiastical_years
         WHERE start_date <= $1::date AND end_date >= $1::date
         FOR SHARE`,
        civilDate,
      );
    }
  }

  const years = civilDate
    ? await db.ecclesiastical_years.findMany({
        where: {
          start_date: { lte: utcCivilDate(civilDate) },
          end_date: { gte: utcCivilDate(civilDate) },
        },
        select: {
          year_id: true,
          start_date: true,
          end_date: true,
          active: true,
        },
      })
    : [];
  const user = await db.users.findUnique({
    where: { user_id: params.userId },
    select: { birthday: true },
  });
  const klass = await db.classes.findUnique({
    where: { class_id: params.classId },
    select: { minimum_age: true },
  });
  if (!klass) {
    throw new AppBadRequestException(
      ErrorCode.CERTIFICATE_IMPORT_CATALOG_NOT_FOUND,
    );
  }

  return evaluateClassCertificateHistoricalAge({
    completedAt: params.completedAt,
    birthday: user?.birthday,
    minimumAge: klass.minimum_age,
    years,
  });
}
