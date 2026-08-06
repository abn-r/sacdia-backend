export const AUTH_CONTEXT_V4_MAX_TTL_MS = 300_000;

export type AuthorizationTerritoryTime = {
  local_field_id: number;
  timezone: string;
  modified_at: string;
};

export type AuthorizationContextEnvelope<T> = {
  value: T;
  valid_until: string;
  territory_time_vector: AuthorizationTerritoryTime[];
};

export type AuthorizationContextSourceSnapshot<T> = {
  value: T;
  boundaries: Date[];
  territoryTimeVector: AuthorizationTerritoryTime[];
};

export type AuthorizationContextV4Ports<T> = {
  versions: { current(userId: string): Promise<bigint> };
  cache: {
    get(
      key: string,
    ): Promise<AuthorizationContextEnvelope<T> | null | undefined>;
    set(
      key: string,
      value: AuthorizationContextEnvelope<T>,
      ttl: number,
    ): Promise<unknown>;
  };
  source: {
    load(
      userId: string,
      now: Date,
    ): Promise<AuthorizationContextSourceSnapshot<T>>;
  };
};

export class AuthorizationContextUnavailableError extends Error {
  readonly code = 'AUTH_CONTEXT_UNAVAILABLE';

  constructor(readonly reason: 'VERSION_UNAVAILABLE' | 'SOURCE_UNAVAILABLE') {
    super(reason);
    this.name = AuthorizationContextUnavailableError.name;
  }
}

export function authorizationContextV4Key(
  userId: string,
  authorizationVersion: bigint,
): string {
  return `auth:context:v4:${userId}:${authorizationVersion}`;
}

export function createAuthorizationContextEnvelope<T>(
  value: T,
  now: Date,
  temporal: Omit<AuthorizationContextSourceSnapshot<T>, 'value'>,
): { envelope: AuthorizationContextEnvelope<T>; ttl: number } {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new AuthorizationContextUnavailableError('SOURCE_UNAVAILABLE');
  }
  const boundaryMs = temporal.boundaries.map((boundary) => boundary.getTime());
  if (boundaryMs.some((candidate) => !Number.isFinite(candidate))) {
    throw new AuthorizationContextUnavailableError('SOURCE_UNAVAILABLE');
  }
  const validUntilMs = Math.min(
    nowMs + AUTH_CONTEXT_V4_MAX_TTL_MS,
    ...boundaryMs,
  );
  const ttl = Math.max(1, validUntilMs - nowMs);
  return {
    envelope: {
      value,
      valid_until: new Date(validUntilMs).toISOString(),
      territory_time_vector: normalizeTerritoryTimeVector(
        temporal.territoryTimeVector,
      ),
    },
    ttl,
  };
}

export function readFreshAuthorizationContextEnvelope<T>(
  envelope: AuthorizationContextEnvelope<T> | null | undefined,
  now: Date,
): T | null {
  if (!envelope) return null;
  const validUntil = Date.parse(envelope.valid_until);
  try {
    normalizeTerritoryTimeVector(envelope.territory_time_vector);
  } catch {
    return null;
  }
  return Number.isFinite(validUntil) && now.getTime() < validUntil
    ? envelope.value
    : null;
}

export function selectPreferredEffectiveGrant<
  T extends { assignment_id: string },
>(effectiveGrants: T[], preferredAssignmentId: string | null): T | null {
  return (
    effectiveGrants.find(
      (grant) => grant.assignment_id === preferredAssignmentId,
    ) ??
    effectiveGrants[0] ??
    null
  );
}

export async function resolveAuthorizationContextV4<T>(
  userId: string,
  now: Date,
  ports: AuthorizationContextV4Ports<T>,
): Promise<T> {
  let version: bigint;
  try {
    version = await ports.versions.current(userId);
  } catch {
    throw new AuthorizationContextUnavailableError('VERSION_UNAVAILABLE');
  }
  const key = authorizationContextV4Key(userId, version);
  try {
    const cached = readFreshAuthorizationContextEnvelope(
      await ports.cache.get(key),
      now,
    );
    if (cached !== null) return cached;
  } catch {
    // Redis is an optimization. Continue with the canonical source.
  }
  let source: AuthorizationContextSourceSnapshot<T>;
  try {
    source = await ports.source.load(userId, now);
  } catch {
    throw new AuthorizationContextUnavailableError('SOURCE_UNAVAILABLE');
  }
  const { envelope, ttl } = createAuthorizationContextEnvelope(
    source.value,
    now,
    source,
  );
  try {
    await ports.cache.set(key, envelope, ttl);
  } catch {
    // A failed write cannot weaken the result already verified by the source.
  }
  return source.value;
}

function normalizeTerritoryTimeVector(
  values: AuthorizationTerritoryTime[],
): AuthorizationTerritoryTime[] {
  const unique = new Map<number, AuthorizationTerritoryTime>();
  for (const value of values) {
    if (
      !Number.isInteger(value.local_field_id) ||
      value.local_field_id <= 0 ||
      !value.timezone ||
      !Number.isFinite(Date.parse(value.modified_at))
    ) {
      throw new AuthorizationContextUnavailableError('SOURCE_UNAVAILABLE');
    }
    const previous = unique.get(value.local_field_id);
    if (
      previous &&
      (previous.timezone !== value.timezone ||
        previous.modified_at !== value.modified_at)
    ) {
      throw new AuthorizationContextUnavailableError('SOURCE_UNAVAILABLE');
    }
    unique.set(value.local_field_id, value);
  }
  return [...unique.values()].sort(
    (left, right) => left.local_field_id - right.local_field_id,
  );
}
