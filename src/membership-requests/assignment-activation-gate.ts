import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { AppConflictException } from '../common/errors/app.exception';
import { ErrorCode } from '../common/errors/error-codes';
import { ageToday } from '../common/age/age.util';
import {
  DEFAULT_COUNTRY_AGE_POLICY,
  type CountryAgePolicy,
} from '../common/age/country-age-policy.service';
import {
  lockDependent,
  lockDependentsAscending,
} from '../guardianships/guardianship-queries';

type Db = Prisma.TransactionClient | PrismaService;

/**
 * The ONE rule every write that makes a `club_role_assignments` row ACTIVE must
 * pass (family-profiles FP-39/C7, verify 2c C1/C2, Phase 3a FP3-01): anyone
 * UNDER THE AGE OF MAJORITY needs a VERIFIED guardian consent, whether or not
 * they have a `dependent_profiles` row (a self-registered 13-17 has none).
 * Adults are never gated.
 *
 * "Minor" = has a dependent profile, OR is under the country's age of majority
 * (calendar math in the country TZ), OR has NO birthday on file (fail closed:
 * an unknown age is never activated without consent; the user can set a valid
 * adult birthday and retry).
 *
 * - Call it with the SAME transaction client that writes the assignment, right
 *   before the write, so a consent revoked meanwhile blocks the activation.
 * - For minors it takes the per-dependent advisory lock (the one verify,
 *   revoke, leave and evidence upload take), so an activation and a consent
 *   change are serialized instead of racing under READ COMMITTED.
 * - Rows with `is_test_data` never count (FP-03); a revoked row is never
 *   `verified` (DB check `guardianships_revoked_ck`). Club custody rows count
 *   as consent (Phase 2).
 *
 * The guard spec `assignment-activation-gate.inventory.spec.ts` fails when a
 * new activating write does not call one of these helpers.
 */
export async function isAssignmentActivationAllowed(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  if (!(await isMinorForActivation(tx, userId))) return true;

  await lockDependent(tx, userId);

  const verified = await tx.guardianships.findFirst({
    where: {
      dependent_user_id: userId,
      consent_status: 'verified',
      is_test_data: false,
    },
    select: { guardianship_id: true },
  });
  return verified !== null;
}

/** The age policy of a country read through the SAME client, or the defaults. */
async function readAgePolicy(
  tx: Db,
  countryId: number | null,
): Promise<CountryAgePolicy> {
  if (countryId === null) return { ...DEFAULT_COUNTRY_AGE_POLICY };
  const country = await tx.countries.findUnique({
    where: { country_id: countryId },
    select: { age_of_majority: true, age_reference_timezone: true },
  });
  if (!country) return { ...DEFAULT_COUNTRY_AGE_POLICY };
  return {
    ...DEFAULT_COUNTRY_AGE_POLICY,
    ageOfMajority: country.age_of_majority,
    timeZone:
      country.age_reference_timezone ?? DEFAULT_COUNTRY_AGE_POLICY.timeZone,
  };
}

/**
 * Pure decision for a user row already read: a minor is someone with a
 * dependent profile, with no birthday (fail closed) or under the majority.
 */
export function isMinorForActivationRow(
  user: { birthday: Date | null; hasDependentProfile: boolean },
  policy: Pick<CountryAgePolicy, 'ageOfMajority' | 'timeZone'>,
  now: Date = new Date(),
): boolean {
  if (user.hasDependentProfile) return true;
  if (!user.birthday) return true;
  return ageToday(user.birthday, policy.timeZone, now) < policy.ageOfMajority;
}

async function isMinorForActivation(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  const user = await tx.users.findUnique({
    where: { user_id: userId },
    select: {
      birthday: true,
      country_id: true,
      dependent_profile: { select: { user_id: true } },
    },
  });
  // Nothing to activate for a user that does not exist (the caller's FK fails).
  if (!user) return false;

  const hasDependentProfile = Boolean(user.dependent_profile);
  // A dependent profile or a missing birthday decides without the country.
  if (hasDependentProfile || !user.birthday) return true;

  const policy = await readAgePolicy(tx, user.country_id);
  return isMinorForActivationRow(
    { birthday: user.birthday, hasDependentProfile },
    policy,
  );
}

/**
 * Throwing form of {@link isAssignmentActivationAllowed}: 409
 * MR_CONSENT_NOT_VERIFIED for a minor without verified consent.
 */
export async function assertAssignmentActivationAllowed(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  if (!(await isAssignmentActivationAllowed(tx, userId))) {
    throw new AppConflictException(ErrorCode.MR_CONSENT_NOT_VERIFIED);
  }
}

/**
 * Which of `userIds` are minors for the activation rule (dependent profile,
 * under the majority of their country, or without a birthday), in ONE users
 * query plus one countries query per distinct country. The value says whether
 * the user holds a dependent profile (a no-profile minor is a self-registered
 * teen). Users that do not exist are absent.
 */
export async function findMinorsForActivation(
  db: Db,
  userIds: Iterable<string>,
): Promise<Map<string, { hasDependentProfile: boolean }>> {
  const unique = [...new Set(userIds)];
  const minors = new Map<string, { hasDependentProfile: boolean }>();
  if (unique.length === 0) return minors;

  const users = await db.users.findMany({
    where: { user_id: { in: unique } },
    select: {
      user_id: true,
      birthday: true,
      country_id: true,
      dependent_profile: { select: { user_id: true } },
    },
  });

  const policies = new Map<number, CountryAgePolicy>();
  for (const user of users) {
    const hasDependentProfile = Boolean(user.dependent_profile);
    // A dependent profile or a missing birthday decides without the country.
    if (hasDependentProfile || !user.birthday) {
      minors.set(user.user_id, { hasDependentProfile });
      continue;
    }
    let policy = DEFAULT_COUNTRY_AGE_POLICY as CountryAgePolicy;
    if (user.country_id !== null) {
      const cached = policies.get(user.country_id);
      if (cached) {
        policy = cached;
      } else {
        policy = await readAgePolicy(db, user.country_id);
        policies.set(user.country_id, policy);
      }
    }
    if (
      isMinorForActivationRow(
        { birthday: user.birthday, hasDependentProfile },
        policy,
      )
    ) {
      minors.set(user.user_id, { hasDependentProfile });
    }
  }
  return minors;
}

/**
 * For a transaction that will gate SEVERAL users (the year cut): take the
 * advisory lock of every minor among `userIds` up front, in ascending
 * user_id order (the global order, see {@link lockDependentsAscending}). The
 * later {@link isAssignmentActivationAllowed} calls then only re-enter locks
 * this transaction already holds, whatever order they run in. Adults take no
 * lock. Call it before the transaction's first write.
 *
 * Minors are the users with a dependent profile PLUS the ones under the age
 * of majority (or without a birthday) by their country policy. `userIds` is a
 * hint read inside the same transaction: a user who becomes a minor after this
 * call is locked by the gate on demand, not in order.
 */
export async function lockActivationDependentsAscending(
  tx: Prisma.TransactionClient,
  userIds: Iterable<string>,
): Promise<string[]> {
  const minors = await findMinorsForActivation(tx, userIds);
  return lockDependentsAscending(tx, minors.keys());
}
