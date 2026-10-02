import { Prisma } from '@prisma/client';
import { AppConflictException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import type { PrismaService } from '../prisma/prisma.service';

export const INVESTITURE_REQUEST_ENROLLMENT_LOCK_PREFIX =
  'investiture-authorization-enrollment:';

export const INVESTITURE_REQUEST_SECTION_LOCK_PREFIX =
  'investiture-authorization-section:';

type AuthorizationStore = PrismaService | Prisma.TransactionClient;

export async function lockInvestitureAuthorizationEnrollment(
  store: AuthorizationStore,
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
