import { Prisma } from '@prisma/client';
import { AppConflictException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { PrismaService } from '../prisma/prisma.service';

export const INVESTITURE_REQUEST_ENROLLMENT_LOCK_PREFIX =
  'investiture-authorization-enrollment:';

export const INVESTITURE_REQUEST_SECTION_LOCK_PREFIX =
  'investiture-authorization-section:';

export const INVESTITURE_REQUEST_USER_LOCK_PREFIX =
  'investiture-authorization-user:';

export const INVESTITURE_REQUEST_YEAR_LOCK_PREFIX =
  'investiture-authorization-year:';

export const INVESTITURE_REQUEST_CALENDAR_LOCK_PREFIX =
  'investiture-authorization-calendar:';

export const INVESTITURE_REQUEST_PASTOR_LOCK_PREFIX =
  'investiture-authorization-pastor:';

export const HISTORICAL_CERTIFICATE_APPLIED = 'HISTORICAL_CERTIFICATE_APPLIED';

export const HISTORICAL_CERTIFICATE_APPLIED_REASON =
  'Investidura aplicada por certificado de un año anterior';

export const LATER_CERTIFICATE_ACCREDITATION_REASON =
  'Investidura acreditada posteriormente mediante certificado validado';

type AuthorizationStore = PrismaService | Prisma.TransactionClient;

/**
 * Un candado advisory solo necesita ejecutar SQL crudo. Los stores reducidos
 * de certificados lo cumplen sin cast (un cast `as never` lo borra
 * `eslint --fix` cuando el cliente de Prisma todavía no está generado).
 */
export type AdvisoryLockStore = {
  $executeRaw: (query: Prisma.Sql) => Promise<unknown>;
};

/** El store puede tomar candados advisory (los dobles de prueba a veces no). */
export function canTakeAdvisoryLocks<T extends object>(
  store: T,
): store is T & AdvisoryLockStore {
  return '$executeRaw' in store && typeof store.$executeRaw === 'function';
}

async function lockAuthorizationKey(
  store: AdvisoryLockStore,
  key: string,
): Promise<void> {
  await store.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
  );
}

export async function lockInvestitureAuthorizationYear(
  store: AdvisoryLockStore,
  ecclesiasticalYearId: number,
): Promise<void> {
  await lockAuthorizationKey(
    store,
    `${INVESTITURE_REQUEST_YEAR_LOCK_PREFIX}${ecclesiasticalYearId}`,
  );
}

export async function lockInvestitureAuthorizationCalendar(
  store: AdvisoryLockStore,
  localFieldId: number,
  ecclesiasticalYearId: number,
): Promise<void> {
  await lockAuthorizationKey(
    store,
    `${INVESTITURE_REQUEST_CALENDAR_LOCK_PREFIX}${localFieldId}:${ecclesiasticalYearId}`,
  );
}

export async function lockInvestitureAuthorizationPastor(
  store: AdvisoryLockStore,
  districtId: number,
  userId: string,
): Promise<void> {
  await lockAuthorizationKey(
    store,
    `${INVESTITURE_REQUEST_PASTOR_LOCK_PREFIX}${districtId}:${userId}`,
  );
}

export async function lockInvestitureAuthorizationSection(
  store: AdvisoryLockStore,
  clubSectionId: number,
  ecclesiasticalYearId: number,
): Promise<void> {
  await lockAuthorizationKey(
    store,
    `${INVESTITURE_REQUEST_SECTION_LOCK_PREFIX}${clubSectionId}:${ecclesiasticalYearId}`,
  );
}

export async function lockInvestitureAuthorizationUser(
  store: AdvisoryLockStore,
  userId: string,
): Promise<void> {
  await lockAuthorizationKey(
    store,
    `${INVESTITURE_REQUEST_USER_LOCK_PREFIX}${userId}`,
  );
}

export async function lockInvestitureAuthorizationEnrollment(
  store: AdvisoryLockStore,
  enrollmentId: number,
): Promise<void> {
  await store.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${INVESTITURE_REQUEST_ENROLLMENT_LOCK_PREFIX}${enrollmentId}`}, 0))`,
  );
}

export async function assertNoPendingInvestitureAuthorization(
  store: AuthorizationStore,
  enrollmentId: number,
): Promise<void> {
  const pending = await store.investiture_authorization_people.findFirst({
    where: { enrollment_id: enrollmentId, status: 'PENDING' },
    select: { person_id: true },
  });
  if (pending) {
    throw new AppConflictException(
      ErrorCode.INVESTITURE_REQUEST_PROGRESS_LOCKED,
    );
  }
}

/**
 * Fase 8: la vía anterior ya no escribe; un expediente viejo bloquea la
 * solicitud nueva solo mientras conserva locked_for_validation.
 */
export function enrollmentOnLegacyInvestiturePipeline(enrollment: {
  investiture_status: string;
  locked_for_validation?: boolean | null;
}): boolean {
  return enrollment.locked_for_validation === true;
}

/**
 * Candado del enrollment y lectura del PENDING.
 * Tiene que correr dentro de la misma transacción que la escritura.
 */
export async function pendingInvestitureAuthorization(
  store: AuthorizationStore,
  enrollmentId: number,
): Promise<boolean> {
  await lockInvestitureAuthorizationEnrollment(store, enrollmentId);
  const pending = await store.investiture_authorization_people.findFirst({
    where: { enrollment_id: enrollmentId, status: 'PENDING' },
    select: { person_id: true },
  });
  return Boolean(pending);
}

/**
 * Candado del enrollment y rechazo si la solicitud nueva tiene un PENDING.
 * Tiene que correr dentro de la misma transacción que la escritura.
 */
export async function rejectLegacyMutationIfAuthorizationPending(
  store: AuthorizationStore,
  enrollmentId: number,
): Promise<void> {
  if (await pendingInvestitureAuthorization(store, enrollmentId)) {
    throw new AppConflictException(
      ErrorCode.INVESTITURE_REQUEST_PROGRESS_LOCKED,
    );
  }
}
