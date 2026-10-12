import type { Prisma, users_certifications } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import { AppNotFoundException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';

type EnrollmentDbClient = PrismaService | Prisma.TransactionClient;

/**
 * Loads an ACTIVE enrollment owned by `userId`. Shared by the requirements,
 * evidence and closeout services so ownership/active filtering lives in one
 * place. It does NOT check the enrollment status: callers that mutate must
 * additionally call `assertEnrollmentEditable` (or their own status rule).
 */
export async function getOwnedEnrollmentOrThrow(
  db: EnrollmentDbClient,
  userId: string,
  enrollmentId: number,
): Promise<users_certifications> {
  const enrollment = await db.users_certifications.findFirst({
    where: {
      enrollment_id: enrollmentId,
      user_id: userId,
      active: true,
    },
  });

  if (!enrollment) {
    throw new AppNotFoundException(ErrorCode.CERT_ENROLLMENT_NOT_FOUND);
  }

  return enrollment;
}
