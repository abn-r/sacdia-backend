import { investiture_status_enum, Prisma } from '@prisma/client';
import { AppConflictException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';

/**
 * Fase 8: el progreso de clase solo se cierra con `locked_for_validation` o con
 * un estado terminal. Un expediente de la cadena anterior que ya se soltó
 * (lock en false) vuelve a ser editable aunque conserve su estado.
 */
const PROGRESS_MUTATION_BLOCKED_STATUSES = new Set(['INVESTIDO', 'EXPIRED']);

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
export const TERMINAL_INVESTITURE_STATUS_VALUES = [
  investiture_status_enum.INVESTIDO,
  investiture_status_enum.EXPIRED,
] as const;

const TERMINAL_INVESTITURE_STATUSES = new Set<string>(
  TERMINAL_INVESTITURE_STATUS_VALUES,
);

/**
 * Excludes class progress whose enrollment is INVESTIDO/EXPIRED. Review
 * actions on that progress always fail with CLASS_PROGRESS_LOCKED, so the
 * review queue and its KPIs must not list or count it. Progress without an
 * enrollment stays in.
 */
export const NOT_TERMINAL_ENROLLMENT_WHERE: Prisma.class_section_progressWhereInput =
  {
    NOT: {
      enrollments: {
        is: {
          investiture_status: { in: [...TERMINAL_INVESTITURE_STATUS_VALUES] },
        },
      },
    },
  };

/** Raw SQL twin of NOT_TERMINAL_ENROLLMENT_WHERE for a `csp` alias. */
export const NOT_TERMINAL_ENROLLMENT_SQL = `
  AND NOT EXISTS (
    SELECT 1 FROM enrollments e
    WHERE e.enrollment_id = csp.enrollment_id
      AND e.investiture_status IN ('INVESTIDO', 'EXPIRED')
  )`;

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
