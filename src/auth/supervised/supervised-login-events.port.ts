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

/** Merges a (possibly partial or missing) binding over the no-op default. */
export function resolveSupervisedLoginEvents(
  bound?: Partial<SupervisedLoginEvents> | null,
): SupervisedLoginEvents {
  return { ...NOOP_SUPERVISED_LOGIN_EVENTS, ...(bound ?? {}) };
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
