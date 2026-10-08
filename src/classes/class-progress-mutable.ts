import type { Prisma } from '@prisma/client';
import { AppConflictException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

const PROGRESS_MUTATION_BLOCKED_STATUSES = new Set([
  'SUBMITTED',
  'CLUB_APPROVED',
  'COORDINATOR_APPROVED',
  'FIELD_APPROVED',
  'INVESTIDO',
  'EXPIRED',
]);

export function assertClassProgressMutable(enrollment: {
  investitureStatus: string;
  lockedForValidation: boolean;
}): void {
  if (
    enrollment.lockedForValidation ||
    PROGRESS_MUTATION_BLOCKED_STATUSES.has(enrollment.investitureStatus)
  ) {
    throw new AppConflictException(ErrorCode.CLASS_PROGRESS_LOCKED);
  }
}

/**
 * BC-11 / BCR-2: estados que cierran el expediente para siempre.
 * La revisión de evidencias y `submitSection` solo bloquean estos dos;
 * `locked_for_validation` y los estados del flujo anterior se comportan como
 * en 113d8ba.
 */
const TERMINAL_INVESTITURE_STATUSES = new Set(['INVESTIDO', 'EXPIRED']);

export function assertClassProgressNotTerminal(enrollment: {
  investitureStatus: string;
}): void {
  if (TERMINAL_INVESTITURE_STATUSES.has(enrollment.investitureStatus)) {
    throw new AppConflictException(ErrorCode.CLASS_PROGRESS_LOCKED);
  }
}

/**
 * Lee el estado del enrollment con la transacción que escribe y rechaza
 * INVESTIDO/EXPIRED. Tiene que llamarse después de tomar el candado del
 * enrollment (`lockInvestitureAuthorizationEnrollment`), para que un
 * INVESTIDO recién confirmado por otra transacción sea visible aquí.
 */
export async function assertEnrollmentNotTerminalInTransaction(
  tx: Pick<Prisma.TransactionClient, 'enrollments'>,
  enrollmentId: number,
): Promise<void> {
  const enrollment = await tx.enrollments.findUnique({
    where: { enrollment_id: enrollmentId },
    select: { investiture_status: true },
  });
  if (!enrollment) {
    return;
  }
  assertClassProgressNotTerminal({
    investitureStatus: enrollment.investiture_status ?? '',
  });
}
