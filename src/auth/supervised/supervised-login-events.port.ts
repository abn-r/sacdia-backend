/**
 * Outbound port of the login pipeline towards the guardian security notices
 * (sub-phase 3a, B26/B44). The login code reports what happened; the adapter
 * bound in AuthModule decides who to tell. Without a binding every event is a
 * no-op, so the login path never depends on the notification stack.
 *
 * Contract for implementations: best effort. They MUST NOT throw, and the
 * login code does not await them on its critical path.
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
}

export const NOOP_SUPERVISED_LOGIN_EVENTS: SupervisedLoginEvents = {
  onLoginLocked: () => undefined,
};
