import type { Prisma } from '@prisma/client';

/**
 * BCR-6. Única regla que decide si una asignación de pastor de distrito puede
 * autorizar investiduras. La usan el listado, los autorizadores de un club, la
 * resolución y los correos (presentación y recordatorios).
 *
 * Una asignación autoriza solo si la persona tiene:
 *  1. el rol global `pastor`, activo, comparado sin distinguir mayúsculas y
 *     solo en la categoría GLOBAL; y
 *  2. una cuenta activa. La eliminación de cuenta es lógica
 *     (`users.active = false`, ver `auth/account-deletion.service.ts`).
 *
 * Una asignación que no cumple sigue ocupando cupo, pero no autoriza, no
 * figura entre los autorizadores y no recibe correos.
 */
export const PASTOR_ROLE_NAME = 'pastor';

const PASTOR_ROLE_WHERE: Prisma.users_rolesWhereInput = {
  active: true,
  roles: {
    role_name: { equals: PASTOR_ROLE_NAME, mode: 'insensitive' },
    active: true,
    role_category: 'GLOBAL',
  },
};

/**
 * Mismo criterio que `pastorEligibility` pero como filtro de consulta: cuenta
 * activa y rol global `pastor` activo. Lo usa la búsqueda de candidatos, para
 * que quien se ofrece al asignar sea exactamente quien podría autorizar.
 */
export const PASTOR_ELIGIBLE_USER_WHERE: Prisma.usersWhereInput = {
  active: true,
  users_roles: { some: PASTOR_ROLE_WHERE },
};

export type PastorEligibility = {
  canAuthorize: boolean;
  /** La cuenta está eliminada o inactiva. */
  accountInactive: boolean;
  /** Falta el rol global `pastor` activo. */
  roleMissing: boolean;
};

export type PastorEligibilityDb = Pick<Prisma.TransactionClient, 'users'>;

/** Calcula la elegibilidad de cada usuario. Un usuario inexistente no puede autorizar. */
export async function pastorEligibility(
  db: PastorEligibilityDb,
  userIds: string[],
): Promise<Map<string, PastorEligibility>> {
  const unique = [...new Set(userIds.filter((id) => id))];
  const result = new Map<string, PastorEligibility>();
  for (const id of unique) {
    result.set(id, {
      canAuthorize: false,
      accountInactive: true,
      roleMissing: true,
    });
  }
  if (unique.length === 0) {
    return result;
  }
  const users = await db.users.findMany({
    where: { user_id: { in: unique } },
    select: {
      user_id: true,
      active: true,
      users_roles: {
        where: PASTOR_ROLE_WHERE,
        select: { user_role_id: true },
        take: 1,
      },
    },
  });
  for (const user of users) {
    const roleMissing = user.users_roles.length === 0;
    const accountInactive = user.active !== true;
    result.set(user.user_id, {
      canAuthorize: !roleMissing && !accountInactive,
      accountInactive,
      roleMissing,
    });
  }
  return result;
}

export async function pastorCanAuthorize(
  db: PastorEligibilityDb,
  userId: string,
): Promise<boolean> {
  return (
    (await pastorEligibility(db, [userId])).get(userId)?.canAuthorize === true
  );
}

export async function eligiblePastorUserIds(
  db: PastorEligibilityDb,
  userIds: string[],
): Promise<Set<string>> {
  const map = await pastorEligibility(db, userIds);
  return new Set(
    [...map.entries()].flatMap(([id, value]) =>
      value.canAuthorize ? [id] : [],
    ),
  );
}
