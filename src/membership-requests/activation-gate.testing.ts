/**
 * Test helpers for the activation consent gate (Phase 3a). The gate reads the
 * `users` row (birthday, country, dependent profile) through the transaction
 * client; these builders produce the rows specs feed to `users.findUnique` /
 * `users.findMany`. Not imported by production code.
 */

export interface GateUserRow {
  user_id?: string;
  birthday: Date | null;
  country_id: number | null;
  dependent_profile: { user_id: string } | null;
}

const yearsAgo = (years: number): Date => {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCDate(date.getUTCDate() - 3);
  return date;
};

/** An adult account holder: the gate is a no-op for them. */
export const gateAdultUser = (userId?: string): GateUserRow => ({
  ...(userId ? { user_id: userId } : {}),
  birthday: new Date('1990-01-01T00:00:00.000Z'),
  country_id: null,
  dependent_profile: null,
});

/** A dependent (under 13, with a dependent profile). */
export const gateDependentUser = (userId: string): GateUserRow => ({
  user_id: userId,
  birthday: yearsAgo(9),
  country_id: null,
  dependent_profile: { user_id: userId },
});

/** A self-registered teen: no dependent profile, under the age of majority. */
export const gateTeenUser = (userId?: string, years = 16): GateUserRow => ({
  ...(userId ? { user_id: userId } : {}),
  birthday: yearsAgo(years),
  country_id: null,
  dependent_profile: null,
});

/** `users.findMany` rows for a list of dependents. */
export const gateDependentRows = (userIds: string[]): GateUserRow[] =>
  userIds.map((userId) => gateDependentUser(userId));

/**
 * `users.findUnique` stub for specs whose transaction mock ALSO uses
 * `users.findUnique` for something else. The gate selects `dependent_profile`,
 * so a call with that select gets the gate row and any other call gets `other`.
 * `gateRef.current` can be swapped per test.
 */
export function gateAwareUserFindUnique<T>(
  other: T,
  gateRef: { current: GateUserRow } = { current: gateAdultUser() },
): jest.Mock & { gateRef: { current: GateUserRow } } {
  const fn = jest.fn(async (args?: { select?: Record<string, unknown> }) =>
    args?.select && 'dependent_profile' in args.select
      ? gateRef.current
      : other,
  ) as unknown as jest.Mock & { gateRef: { current: GateUserRow } };
  fn.gateRef = gateRef;
  return fn;
}
