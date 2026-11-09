import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { LoginFailureCounter } from '../../auth/login-failure-counter';
import { NOOP_SUPERVISED_LOGIN_EVENTS } from '../../auth/supervised/supervised-login-events.port';

/**
 * Progressive lockout for second-factor (TOTP) codes, keyed on the USER id.
 * Same parameters and Redis/in-process machinery as the login lockout (5 wrong
 * codes in 15 min lock 15 min, doubling per episode up to 24 h), but:
 *  - its own key namespace (`mfa:*`), so it never shares a counter with login;
 *  - the supervised-login events are bound to the no-op: a lock here must not
 *    look the id up as an email/handle nor notify guardians as a login lock;
 *  - callers pass the user id as the identifier and NO ip (one bucket per user).
 */
@Injectable()
export class MfaFailureCounter extends LoginFailureCounter {
  protected override readonly keyPrefix: string = 'mfa';

  constructor(@Inject(CACHE_MANAGER) cache: Cache) {
    super(cache, NOOP_SUPERVISED_LOGIN_EVENTS);
  }
}
