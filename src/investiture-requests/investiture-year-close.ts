import { Prisma } from '@prisma/client';
import {
  lockInvestitureAuthorizationEnrollment,
  lockInvestitureAuthorizationSection,
  lockInvestitureAuthorizationUser,
  lockInvestitureAuthorizationYear,
} from './investiture-request-lock';

type PendingPerson = {
  person_id: string;
  user_id: string;
  enrollment_id: number;
  request: {
    club_section_id: number;
    ecclesiastical_year_id: number;
  };
};

/**
 * Closes pending investiture authorizations as not invested for their year.
 * A second call matches no PENDING row. INVESTED and other decisions stay.
 * It does not insert a request in the next year and does not write a rejection.
 */
export async function closePendingInvestitureAuthorizations(
  tx: Prisma.TransactionClient,
  request: Prisma.investiture_authorization_requestsWhereInput,
  yearIds: readonly number[] = [],
): Promise<number> {
  const declaredYears = [...new Set(yearIds)].sort(
    (left, right) => left - right,
  );
  for (const yearId of declaredYears) {
    await lockInvestitureAuthorizationYear(tx, yearId);
  }
  const pending = (await tx.investiture_authorization_people.findMany({
    where: { status: 'PENDING', request },
    select: {
      person_id: true,
      user_id: true,
      enrollment_id: true,
      request: {
        select: {
          club_section_id: true,
          ecclesiastical_year_id: true,
        },
      },
    },
    orderBy: { person_id: 'asc' },
  })) as PendingPerson[];
  if (pending.length === 0) {
    return 0;
  }

  const discoveredYears = [
    ...new Set(pending.map((person) => person.request.ecclesiastical_year_id)),
  ].sort((left, right) => left - right);
  const maxDeclared =
    declaredYears.length > 0
      ? declaredYears[declaredYears.length - 1]
      : Number.NEGATIVE_INFINITY;
  const extraYears = discoveredYears.filter(
    (yearId) => !declaredYears.includes(yearId),
  );
  if (extraYears.some((yearId) => yearId < maxDeclared)) {
    throw new Error('INVESTITURE_YEAR_LOCK_ORDER');
  }
  for (const yearId of extraYears) {
    await lockInvestitureAuthorizationYear(tx, yearId);
  }

  const groups = new Map<string, PendingPerson[]>();
  for (const person of pending) {
    const key = `${person.request.ecclesiastical_year_id}:${person.request.club_section_id}`;
    const rows = groups.get(key) ?? [];
    rows.push(person);
    groups.set(key, rows);
  }

  let closed = 0;
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key) ?? [];
    const sectionId = group[0]?.request.club_section_id;
    const yearId = group[0]?.request.ecclesiastical_year_id;
    if (sectionId == null || yearId == null) {
      continue;
    }
    await lockInvestitureAuthorizationSection(tx, sectionId, yearId);
    const userIds = [...new Set(group.map((person) => person.user_id))].sort();
    for (const userId of userIds) {
      await lockInvestitureAuthorizationUser(tx, userId);
    }
    for (const enrollmentId of [
      ...new Set(group.map((person) => person.enrollment_id)),
    ].sort((left, right) => left - right)) {
      await lockInvestitureAuthorizationEnrollment(tx, enrollmentId);
    }
    const updated = await tx.investiture_authorization_people.updateMany({
      where: {
        person_id: { in: group.map((person) => person.person_id) },
        status: 'PENDING',
      },
      data: {
        status: 'CLOSED_YEAR',
        resolution_code: 'CLOSED_YEAR',
      },
    });
    closed += updated.count;
  }
  return closed;
}
