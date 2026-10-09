import { AppBadRequestException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import {
  INVESTITURE_REQUEST_TIME_ZONE_FALLBACK,
  investitureRequestYearEnded,
  normalizeInvestitureTimeZone,
} from '../investiture-requests/ecclesiastical-year-local-day';
import {
  HISTORICAL_CERTIFICATE_APPLIED,
  HISTORICAL_CERTIFICATE_APPLIED_REASON,
  canTakeAdvisoryLocks,
  lockInvestitureAuthorizationEnrollment,
  lockInvestitureAuthorizationUser,
} from '../investiture-requests/investiture-request-lock';

type YearStart = {
  year_id: number;
  start_date: Date | string;
  end_date?: Date | string;
  active?: boolean;
};

type EnrollmentRow = {
  enrollment_id: number;
  ecclesiastical_year_id: number;
  investiture_status: string;
  investiture_date: Date | null;
  record_kind: string;
  modified_at: Date;
};

type PendingPerson = {
  person_id: string;
  enrollment_id: number;
  status?: string;
  request?: {
    ecclesiastical_year_id: number;
    club_section_id?: number;
  } | null;
  enrollment?: {
    ecclesiastical_year_id: number;
    record_kind: string;
  } | null;
};

export type EndedSameYearCertificatePerson = {
  person_id: string;
  local_field_id: number | null;
};

export type LiveAuthorizationStore = {
  $executeRaw?: (query: unknown) => Promise<unknown>;
  ecclesiastical_years: {
    findMany: (args: {
      where?: { year_id?: { in?: number[] } };
      select?: {
        year_id: true;
        start_date: true;
        end_date: true;
        active: true;
      };
    }) => Promise<YearStart[]>;
  };
  enrollments: {
    findMany: (args: {
      where: { user_id: string; class_id: number };
      select: {
        enrollment_id: true;
        ecclesiastical_year_id: true;
        investiture_status: true;
        investiture_date: true;
        record_kind: true;
        modified_at: true;
      };
    }) => Promise<EnrollmentRow[]>;
  };
  investiture_authorization_people: {
    findMany: (args: {
      where: { user_id: string; class_id: number; status: 'PENDING' };
      select: {
        person_id: true;
        enrollment_id: true;
        request: {
          select: {
            ecclesiastical_year_id: true;
            club_section_id: true;
          };
        };
      };
    }) => Promise<PendingPerson[]>;
    updateMany: (args: {
      where: { person_id: { in: string[] }; status: 'PENDING' };
      data:
        | {
            status: 'REMOVED';
            resolution_code: string;
            system_reason: string;
            rejection_reason: null;
          }
        | {
            status: 'CLOSED_YEAR';
            resolution_code: 'CLOSED_YEAR';
          };
    }) => Promise<{ count: number }>;
  };
};

export function isCertificateAuthorizationPending(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code ===
      ErrorCode.CERTIFICATE_IMPORT_AUTHORIZATION_PENDING
  );
}

/** Año de la solicitud, no el de inicio de la inscripción. */
function requestYearId(person: PendingPerson): number | null {
  if (person.enrollment?.record_kind !== 'OPERATIONAL') return null;
  return person.request?.ecclesiastical_year_id ?? null;
}

function withEnrollmentYears(
  pending: PendingPerson[],
  rows: EnrollmentRow[],
): PendingPerson[] {
  return pending.map((person) => {
    const row = rows.find(
      (item) => item.enrollment_id === person.enrollment_id,
    );
    if (!row && person.enrollment) return person;
    return {
      ...person,
      enrollment: row
        ? {
            ecclesiastical_year_id: row.ecclesiastical_year_id,
            record_kind: row.record_kind,
          }
        : null,
    };
  });
}

async function readPending(
  db: LiveAuthorizationStore,
  userId: string,
  classId: number,
): Promise<PendingPerson[]> {
  return db.investiture_authorization_people.findMany({
    where: { user_id: userId, class_id: classId, status: 'PENDING' },
    select: {
      person_id: true,
      enrollment_id: true,
      request: {
        select: { ecclesiastical_year_id: true, club_section_id: true },
      },
    },
  });
}

async function readEnrollments(
  db: LiveAuthorizationStore,
  userId: string,
  classId: number,
): Promise<EnrollmentRow[]> {
  return db.enrollments.findMany({
    where: { user_id: userId, class_id: classId },
    select: {
      enrollment_id: true,
      ecclesiastical_year_id: true,
      investiture_status: true,
      investiture_date: true,
      record_kind: true,
      modified_at: true,
    },
  });
}

async function yearStarts(
  db: LiveAuthorizationStore,
  yearIds: number[],
): Promise<Map<number, number>> {
  const rows = await db.ecclesiastical_years.findMany({
    where: { year_id: { in: yearIds } },
    select: {
      year_id: true,
      start_date: true,
      end_date: true,
      active: true,
    },
  });
  return new Map(
    rows.map((row) => [row.year_id, new Date(row.start_date).getTime()]),
  );
}

function sameYearPeople(
  pending: PendingPerson[],
  certificateYearId: number,
): PendingPerson[] {
  return pending.filter(
    (person) => requestYearId(person) === certificateYearId,
  );
}

async function earlierPeople(
  db: LiveAuthorizationStore,
  pending: PendingPerson[],
  certificateYearId: number,
): Promise<PendingPerson[]> {
  const others = pending.filter((person) => {
    const yearId = requestYearId(person);
    return yearId != null && yearId !== certificateYearId;
  });
  if (others.length === 0) return [];
  const starts = await yearStarts(db, [
    certificateYearId,
    ...others.map((person) => requestYearId(person)!),
  ]);
  const certificateStart = starts.get(certificateYearId);
  if (certificateStart == null) {
    throw new AppBadRequestException(
      ErrorCode.CERTIFICATE_IMPORT_YEAR_NOT_FOUND,
    );
  }
  return others.filter((person) => {
    const start = starts.get(requestYearId(person)!);
    return start != null && certificateStart < start;
  });
}

export async function rejectSameYearLiveAuthorization(
  db: LiveAuthorizationStore,
  params: { userId: string; classId: number; certificateYearId: number },
): Promise<void> {
  const pending = withEnrollmentYears(
    await readPending(db, params.userId, params.classId),
    await readEnrollments(db, params.userId, params.classId),
  );
  if (sameYearPeople(pending, params.certificateYearId).length > 0) {
    throw new AppBadRequestException(
      ErrorCode.CERTIFICATE_IMPORT_AUTHORIZATION_PENDING,
    );
  }
}

async function lockEnrollments(
  db: LiveAuthorizationStore,
  enrollmentIds: number[],
): Promise<void> {
  if (!canTakeAdvisoryLocks(db)) return;
  for (const enrollmentId of [...new Set(enrollmentIds)].sort(
    (left, right) => left - right,
  )) {
    await lockInvestitureAuthorizationEnrollment(db, enrollmentId);
  }
}

type YearRow = YearStart & { end_date: Date | string; active: boolean };

type SectionField = {
  fieldId: number | null;
  timeZone: string;
};

function requestYearEnded(year: YearRow, now: Date, timeZone: string): boolean {
  return investitureRequestYearEnded({
    active: year.active,
    endDate: year.end_date,
    now,
    timeZone,
  });
}

export async function sectionField(
  db: LiveAuthorizationStore,
  clubSectionId: number | null | undefined,
): Promise<SectionField> {
  const fallback: SectionField = {
    fieldId: null,
    timeZone: INVESTITURE_REQUEST_TIME_ZONE_FALLBACK,
  };
  if (clubSectionId == null) return fallback;
  const sections = (
    db as {
      club_sections?: {
        findUnique: (args: {
          where: { club_section_id: number };
          select: {
            clubs: {
              select: {
                local_field_id: true;
                local_fields: { select: { timezone: true } };
              };
            };
          };
        }) => Promise<{
          clubs: {
            local_field_id: number | null;
            local_fields: { timezone: string | null } | null;
          } | null;
        } | null>;
      };
    }
  ).club_sections;
  if (!sections?.findUnique) return fallback;
  const row = await sections.findUnique({
    where: { club_section_id: clubSectionId },
    select: {
      clubs: {
        select: {
          local_field_id: true,
          local_fields: { select: { timezone: true } },
        },
      },
    },
  });
  return {
    fieldId: row?.clubs?.local_field_id ?? null,
    timeZone: normalizeInvestitureTimeZone(row?.clubs?.local_fields?.timezone),
  };
}

async function closeEndedRequests(
  db: LiveAuthorizationStore,
  params: {
    userId: string;
    classId: number;
    heldYearIds?: ReadonlySet<number>;
    now?: Date;
  },
  rows: EnrollmentRow[],
): Promise<PendingPerson[]> {
  const pending = withEnrollmentYears(
    await readPending(db, params.userId, params.classId),
    rows,
  );
  const yearIds = [
    ...new Set(
      pending
        .map((person) => requestYearId(person))
        .filter((yearId): yearId is number => yearId != null),
    ),
  ];
  const years = new Map(
    (await yearRows(db, yearIds)).map((year) => [year.year_id, year] as const),
  );
  const now = params.now ?? new Date();
  const ended: PendingPerson[] = [];
  for (const person of pending) {
    const yearId = requestYearId(person);
    if (yearId == null) continue;
    if (params.heldYearIds && !params.heldYearIds.has(yearId)) continue;
    const year = years.get(yearId);
    if (year == null) continue;
    const field =
      year.active === false
        ? null
        : await sectionField(db, person.request?.club_section_id);
    if (
      requestYearEnded(
        year,
        now,
        field?.timeZone ?? INVESTITURE_REQUEST_TIME_ZONE_FALLBACK,
      )
    ) {
      ended.push(person);
    }
  }
  if (ended.length > 0) {
    await db.investiture_authorization_people.updateMany({
      where: {
        person_id: { in: ended.map((person) => person.person_id) },
        status: 'PENDING',
      },
      data: {
        status: 'CLOSED_YEAR',
        resolution_code: 'CLOSED_YEAR',
      },
    });
  }
  const endedIds = new Set(ended.map((person) => person.person_id));
  return pending.filter((person) => !endedIds.has(person.person_id));
}

async function yearRows(
  db: LiveAuthorizationStore,
  yearIds: number[],
): Promise<YearRow[]> {
  if (yearIds.length === 0) return [];
  const rows = await db.ecclesiastical_years.findMany({
    where: { year_id: { in: yearIds } },
    select: {
      year_id: true,
      start_date: true,
      end_date: true,
      active: true,
    },
  });
  return rows.filter(
    (row): row is YearRow => row.end_date != null && row.active != null,
  );
}

/**
 * Personas PENDING o CLOSED_YEAR del mismo año del certificado, cuando ese
 * año ya terminó en la zona del Campo de la solicitud (sección → club → Campo).
 * Un año inactivo cuenta como terminado sin consultar la zona.
 */
export async function findEndedSameYearCertificatePeople(
  db: LiveAuthorizationStore,
  params: {
    userId: string;
    classId: number;
    certificateYearId: number;
    now?: Date;
  },
): Promise<EndedSameYearCertificatePerson[]> {
  const people = (await db.investiture_authorization_people.findMany({
    where: {
      user_id: params.userId,
      class_id: params.classId,
      status: { in: ['PENDING', 'CLOSED_YEAR'] },
    },
    select: {
      person_id: true,
      enrollment_id: true,
      status: true,
      request: {
        select: { ecclesiastical_year_id: true, club_section_id: true },
      },
    },
  } as never)) as Array<{
    person_id: string;
    enrollment_id: number;
    status?: string;
    request?: {
      ecclesiastical_year_id?: number;
      club_section_id?: number;
    } | null;
    enrollment?: { record_kind?: string } | null;
  }>;
  const enrollmentRows = await readEnrollments(
    db,
    params.userId,
    params.classId,
  );
  const rows = people.filter((person) => {
    if (person.status !== 'PENDING' && person.status !== 'CLOSED_YEAR') {
      return false;
    }
    if (person.request?.ecclesiastical_year_id !== params.certificateYearId) {
      return false;
    }
    const enrollment = enrollmentRows.find(
      (row) => row.enrollment_id === person.enrollment_id,
    );
    const recordKind =
      enrollment?.record_kind ?? person.enrollment?.record_kind;
    return recordKind === 'OPERATIONAL';
  });
  if (rows.length === 0) return [];
  const year = (await yearRows(db, [params.certificateYearId])).find(
    (row) => row.year_id === params.certificateYearId,
  );
  if (!year) return [];
  const now = params.now ?? new Date();
  const matched: EndedSameYearCertificatePerson[] = [];
  for (const person of rows) {
    const field = await sectionField(db, person.request?.club_section_id);
    if (!requestYearEnded(year, now, field.timeZone)) continue;
    matched.push({
      person_id: person.person_id,
      local_field_id: field.fieldId,
    });
  }
  return matched;
}

export async function pendingAuthorizationYearIds(
  db: LiveAuthorizationStore,
  userId: string,
  classId: number,
): Promise<number[]> {
  const pending = await readPending(db, userId, classId);
  return [
    ...new Set(
      pending
        .map((person) => person.request?.ecclesiastical_year_id)
        .filter((yearId): yearId is number => yearId != null),
    ),
  ].sort((left, right) => left - right);
}

/**
 * El candado advisory del año se toma antes, en orden ascendente, fuera de esta guarda.
 * Aquí siguen el de usuario y el de enrollment, en ese orden, y después la decisión.
 * El de usuario no se omite aunque la primera lectura no vea un PENDING:
 * una presentación de un año posterior no toma el candado de este año.
 * Un PENDING cuyo año ya terminó se cierra como CLOSED_YEAR y deja de contar.
 * IA-57 rechaza el año de la solicitud. IA-59 retira un pendiente cuya
 * solicitud es posterior al certificado. Devuelve las inscripciones releídas.
 */
export async function guardCertificateApprovalAuthorization(
  db: LiveAuthorizationStore,
  params: {
    userId: string;
    classId: number;
    certificateYearId: number;
    heldYearIds?: ReadonlySet<number>;
    now?: Date;
  },
): Promise<EnrollmentRow[]> {
  if (canTakeAdvisoryLocks(db)) {
    await lockInvestitureAuthorizationUser(db, params.userId);
  }
  const firstRows = await readEnrollments(db, params.userId, params.classId);
  const firstPending = withEnrollmentYears(
    await readPending(db, params.userId, params.classId),
    firstRows,
  );
  await lockEnrollments(db, [
    ...firstRows.map((row) => row.enrollment_id),
    ...firstPending.map((person) => person.enrollment_id),
  ]);
  const rows = await readEnrollments(db, params.userId, params.classId);
  const pending = await closeEndedRequests(db, params, rows);
  if (sameYearPeople(pending, params.certificateYearId).length > 0) {
    throw new AppBadRequestException(
      ErrorCode.CERTIFICATE_IMPORT_AUTHORIZATION_PENDING,
    );
  }
  const earlier = await earlierPeople(db, pending, params.certificateYearId);
  if (earlier.length > 0) {
    await db.investiture_authorization_people.updateMany({
      where: {
        person_id: { in: earlier.map((person) => person.person_id) },
        status: 'PENDING',
      },
      data: {
        status: 'REMOVED',
        resolution_code: HISTORICAL_CERTIFICATE_APPLIED,
        system_reason: HISTORICAL_CERTIFICATE_APPLIED_REASON,
        rejection_reason: null,
      },
    });
  }
  return rows;
}
