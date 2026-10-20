/**
 * Outbound port of the supervised-login code towards the guardian security
 * notices (sub-phase 3a, B26/B39/B44). The login, enable, disable and reset code
 * reports WHAT happened; the adapter bound in GuardianshipsModule decides who to
 * tell and how. Without a binding every event is a no-op, so none of those
 * paths ever depends on the notification stack.
 *
 * Contract for implementations: best effort. They MUST NOT throw, and callers
 * never await them on a critical path (`fireEvent` swallows rejections).
 */
export const SUPERVISED_LOGIN_EVENTS = Symbol('SUPERVISED_LOGIN_EVENTS');

export interface SupervisedLoginEvents {
  /**
   * A lock episode started for this identifier (an email or a login handle,
   * normalized). Fired ONCE per episode, never for an already-locked identifier,
   * and for unknown identifiers too (the adapter looks the teen up and does
   * nothing when there is none: the caller learns nothing either way).
   * The identifier is sensitive: never log it.
   */
  onLoginLocked(input: {
    identifier: string;
    retryAfterSeconds: number;
  }): void | Promise<void>;

  /** A supervised teen started a NEW session by password or social login (never on refresh). */
  onTeenSessionStarted(input: { userId: string }): void | Promise<void>;

  /** The teen changed their own password after proving the current one. */
  onTeenPasswordChanged(input: { userId: string }): void | Promise<void>;

  /** The teen completed an emailed password reset (or the guardian reset it). */
  onPasswordReset(input: {
    dependentUserId: string;
    /** The guardian who triggered it; undefined for the teen's own email reset. */
    actorUserId?: string;
  }): void | Promise<void>;

  /** A guardian enabled the login. */
  onLoginEnabled(input: {
    dependentUserId: string;
    actorUserId: string;
  }): void | Promise<void>;

  /** A guardian (or an admin) disabled the login. */
  onLoginDisabled(input: {
    dependentUserId: string;
    actorUserId: string;
  }): void | Promise<void>;

  /** A guardian re-enabled a disabled login. */
  onLoginReactivated(input: {
    dependentUserId: string;
    actorUserId: string;
  }): void | Promise<void>;

  /** An adult linked as guardian of the teen (to the TEEN, for transparency). */
  onGuardianLinked(input: {
    teenUserId: string;
    guardianUserId: string;
  }): void | Promise<void>;
}

export const NOOP_SUPERVISED_LOGIN_EVENTS: SupervisedLoginEvents = {
  onLoginLocked: () => undefined,
  onTeenSessionStarted: () => undefined,
  onTeenPasswordChanged: () => undefined,
  onPasswordReset: () => undefined,
  onLoginEnabled: () => undefined,
  onLoginDisabled: () => undefined,
  onLoginReactivated: () => undefined,
  onGuardianLinked: () => undefined,
};

/**
 * Resolves a (possibly partial or missing) binding over the no-op default.
 *
 * Each method is looked up through the normal property chain and BOUND to the
 * binding, so a class instance (the real Nest provider, whose methods live on
 * its prototype) works exactly like a plain object. Do NOT replace this with an
 * object spread: a spread only copies OWN properties, so every prototype method
 * of a class instance would silently fall back to the no-op.
 */
export function resolveSupervisedLoginEvents(
  bound?: Partial<SupervisedLoginEvents> | null,
): SupervisedLoginEvents {
  if (!bound) return NOOP_SUPERVISED_LOGIN_EVENTS;
  const source = bound as Record<string, unknown>;
  const resolved = {} as Record<string, unknown>;
  for (const key of Object.keys(NOOP_SUPERVISED_LOGIN_EVENTS)) {
    const method = source[key];
    resolved[key] =
      typeof method === 'function'
        ? (method as (...args: unknown[]) => unknown).bind(bound)
        : NOOP_SUPERVISED_LOGIN_EVENTS[key as keyof SupervisedLoginEvents];
  }
  return resolved as unknown as SupervisedLoginEvents;
}

/**
 * Calls an event and swallows both sync throws and async rejections: a notice
 * problem must never fail or delay the originating login / reset / update. The
 * returned promise always resolves and is meant to be `void`-ed.
 */
export function fireEvent(
  call: () => void | Promise<void>,
  onError?: (error: unknown) => void,
): Promise<void> {
  return Promise.resolve()
    .then(call)
    .catch((error: unknown) => {
      onError?.(error);
    });
}
