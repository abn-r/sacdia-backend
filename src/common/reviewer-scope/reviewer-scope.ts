import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Alcance de un revisor del Campo Local. Lo comparten la carga por certificado
 * y las propuestas de instructor: `super-admin`, y `admin`/`assistant-admin`
 * sin Campo Local, ven todo; quien tiene Campo Local (incluidos `director-lf` y
 * `assistant-lf`) solo ve el suyo.
 */
export type ReviewerAccess = {
  global: boolean;
  localFieldId: number | null;
  superAdmin: boolean;
};

/** Cada módulo decide con qué excepción responde (código y formato propios). */
export type ReviewerScopeErrors = {
  reviewerNotFound: () => Error;
  scopeRequired: () => Error;
};

export async function resolveReviewerAccess(
  prisma: Pick<PrismaService, 'users'>,
  reviewerId: string,
  errors: ReviewerScopeErrors,
): Promise<ReviewerAccess> {
  const reviewer = await prisma.users.findUnique({
    where: { user_id: reviewerId },
    select: {
      local_field_id: true,
      users_roles: {
        where: { active: true },
        select: { roles: { select: { role_name: true } } },
      },
    },
  });

  if (!reviewer) {
    throw errors.reviewerNotFound();
  }

  const roles = new Set(
    reviewer.users_roles.map((entry) => entry.roles.role_name.toLowerCase()),
  );

  if (roles.has('super-admin')) {
    return { global: true, localFieldId: null, superAdmin: true };
  }

  if (
    (roles.has('admin') || roles.has('assistant-admin')) &&
    reviewer.local_field_id == null
  ) {
    return { global: true, localFieldId: null, superAdmin: false };
  }

  if (
    reviewer.local_field_id &&
    (roles.has('admin') ||
      roles.has('assistant-admin') ||
      roles.has('director-lf') ||
      roles.has('assistant-lf'))
  ) {
    return {
      global: false,
      localFieldId: reviewer.local_field_id,
      superAdmin: false,
    };
  }

  throw errors.scopeRequired();
}

/** `onDenied` crea la excepción del módulo cuando el Campo Local no coincide. */
export function assertReviewerCanAccessLocalField(
  access: ReviewerAccess,
  localFieldId: number | null,
  onDenied: () => Error,
): void {
  if (access.global) {
    return;
  }

  if (!access.localFieldId || access.localFieldId !== localFieldId) {
    throw onDenied();
  }
}
