import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Edge-case matrix of family profiles Phase 3 (spec E3-1 .. E3-42), mapped to
 * the automated tests that prove each row (T3c-B20).
 *
 * This spec does not re-test the behavior: it keeps the MAP honest. For every
 * row it asserts that
 *   - the row exists, once, and no row is missing from E3-1 to E3-42;
 *   - each evidence file exists and still contains the quoted test title (or
 *     the quoted comment of the case), so renaming or deleting the test that
 *     covers a row fails HERE instead of silently opening a gap;
 *   - every row names at least one evidence entry.
 *
 * Rows that had NO automated test when the matrix was written got one:
 *   - E3-8 (the login handle never leaves through search, QR card or lists) is
 *     proved below by the handle inventory: the only production files that may
 *     mention `login_handle` are listed, so a new endpoint that selects it has
 *     to be reviewed here first.
 *
 * Phrases are matched after collapsing whitespace, so they survive formatting.
 * They contain no apostrophes on purpose (quotes are escaped in the sources).
 */

interface Evidence {
  /** Path relative to the backend root. */
  file: string;
  /** A phrase that must appear in the file (a test title or its comment). */
  phrase: string;
}

interface Row {
  scenario: string;
  evidence: Evidence[];
}

const ev = (file: string, phrase: string): Evidence => ({ file, phrase });

const GATE = 'src/membership-requests/assignment-activation-gate.spec.ts';
const MR_SERVICE =
  'src/membership-requests/membership-requests.service.spec.ts';
const CONSENT_VERIFY =
  'src/membership-requests/consent-verification.service.spec.ts';
const CONSENT_RACE =
  'src/membership-requests/consent-verification.concurrency.spec.ts';
const LINK_CODES = 'src/guardianships/link-codes.service.spec.ts';
const POWERS = 'src/guardianships/guardian-powers.policy.spec.ts';
const SUPERVISED = 'src/guardianships/supervised-logins.service.spec.ts';
const PENDING_CRON = 'src/guardianships/pending-teen-cron.service.spec.ts';
const NUDGE_CRON =
  'src/guardianships/family-age-transitions-cron.service.spec.ts';
const PURGE_CRON =
  'src/guardianships/dependent-profiles-purge-cron.service.spec.ts';
const LIFECYCLE = 'src/guardianships/guardianship-lifecycle.service.spec.ts';
const PAIRING = 'src/guardianships/device-pairing.service.spec.ts';
const GUARDIAN_NOTIFY =
  'src/guardianships/guardian-notifications.service.spec.ts';
const SUMMARY = 'src/guardianships/guardian-summary.service.spec.ts';
const SECURITY_NOTICES =
  'src/guardianships/guardian-security-notifications.service.spec.ts';
const LOGIN_COUNTER = 'src/auth/login-failure-counter.spec.ts';
const STRATEGY = 'src/auth/strategies/jwt.strategy.spec.ts';
const RESOLVER = 'src/auth/supervised/supervised-principal.resolver.spec.ts';
const GATE_DEVICE = 'src/auth/device/linked-device.gate.spec.ts';
const REVOCATION = 'src/auth/device/linked-device-revocation.spec.ts';
const BETTER_AUTH = 'src/better-auth/better-auth.service.spec.ts';
const AUTH_SERVICE = 'src/auth/auth.service.spec.ts';
const SCOPE_METADATA = 'src/auth/acting-for/acting-scope-metadata.spec.ts';
const ACTING_GUARDS = 'src/common/guards/acting-for-guards.spec.ts';
const PUSH_ROUTER = 'src/notifications/dependent-push-router.service.spec.ts';
const LEGAL_CONTROLLER = 'src/legal/legal.controller.spec.ts';
const DELETION = 'src/auth/account-deletion.service.spec.ts';
const TRIGGERS = 'src/guardianships/linked-device-triggers.matrix.spec.ts';
const CLASSES = 'src/classes/classes.service.spec.ts';
const E2E_SUPERVISED = 'test/supervised-login.e2e-spec.ts';
const E2E_DEVICES = 'test/linked-devices.e2e-spec.ts';
const E2E_DIRECTOR = 'test/director-created-minor.e2e-spec.ts';

export const EDGE_MATRIX: Record<string, Row> = {
  'E3-1': {
    scenario:
      '15-year-old self-registers, joins a club: approve 409, club routes 403',
    evidence: [
      ev(GATE, 'blocks a self-registered 15-year-old with no guardianship'),
      ev(
        MR_SERVICE,
        'blocks a self-registered 16-year-old (no dependent profile) with 409',
      ),
      ev(
        E2E_SUPERVISED,
        'pending: a member-reachable club route is denied with PRINCIPAL_SCOPE_DENIED',
      ),
    ],
  },
  'E3-2': {
    scenario: 'Teen hands the link code to a stranger: pending, no powers',
    evidence: [
      ev(
        LINK_CODES,
        'creates the teen profile, a NON-custodian primary PENDING guardianship without inviter, and never verifies it',
      ),
      ev(
        POWERS,
        'a PENDING guardian gets 403 GUARDIANSHIP_CONSENT_NOT_VERIFIED for control powers',
      ),
      ev(
        E2E_SUPERVISED,
        'a pending guardian has no powers: managing the teen login is 403',
      ),
    ],
  },
  'E3-3': {
    scenario:
      'Teen with no guardian: reminders, freeze at day 90, login 403 FROZEN, purge 90 days later',
    evidence: [
      ev(PENDING_CRON, 'day %i sends reminder level %i -> %i to the teen only'),
      ev(
        PENDING_CRON,
        'freezes in ONE transaction with purge_after = now + 90 days',
      ),
      ev(
        BETTER_AUTH,
        'a frozen account answers 403 AUTH_ACCOUNT_FROZEN with the right password',
      ),
      ev(
        PURGE_CRON,
        'revokes the linked devices of the child inside the SAME transaction',
      ),
    ],
  },
  'E3-4': {
    scenario:
      'Phase 3 deploys with an old guardian-less teen: not frozen on the first run',
    evidence: [
      ev(
        PENDING_CRON,
        'starts the clock at the first evaluation, never freezing an old account',
      ),
    ],
  },
  'E3-5': {
    scenario:
      'Guardian disables the login mid-request: next request 401, session gone',
    evidence: [
      ev(
        STRATEGY,
        'a disabled teen whose tokens were blacklisted gets 401 AUTH_SUPERVISED_ACCESS_REVOKED',
      ),
      ev(
        E2E_SUPERVISED,
        'the token held BEFORE the disable (blacklisted) is cut with the same 401',
      ),
    ],
  },
  'E3-6': {
    scenario:
      'Guardian resets the handle password while the teen is online: old token 401, old password fails',
    evidence: [
      ev(
        STRATEGY,
        'a teen cut by a reset (still supervised) gets the same 401 AUTH_SUPERVISED_ACCESS_REVOKED',
      ),
      ev(
        SUPERVISED,
        'a handle login needs a NEW password: the old hash is replaced and the old password stops working',
      ),
    ],
  },
  'E3-7': {
    scenario:
      'Brute force on a handle / an unknown handle: identical lock, guardian told only for real teens',
    evidence: [
      ev(
        LOGIN_COUNTER,
        'emits the lock-episode event once per episode, never on a failure counted under a lock',
      ),
      ev(
        LOGIN_COUNTER,
        'doubles the lock on each repeat episode, capped at 24 hours',
      ),
      ev(
        SECURITY_NOTICES,
        'lock episode of an UNKNOWN identifier does nothing and reveals nothing',
      ),
    ],
  },
  'E3-8': {
    scenario:
      'Enumeration through login, reset-request, search, QR card, lists: no signal, handle never exposed',
    evidence: [
      ev(
        BETTER_AUTH,
        'answers byte-identical errors for an unknown handle, a known handle with a wrong password and a missing credential',
      ),
      ev(
        BETTER_AUTH,
        'runs a dummy bcrypt comparison and answers the uniform 401',
      ),
      ev(
        AUTH_SERVICE,
        'answers the neutral response for a login handle and queues NO email',
      ),
      // The handle inventory below is the test for search / QR card / lists.
      ev(
        'src/guardianships/family-phase3-edge-matrix.spec.ts',
        'the login handle is read by an allowlisted set of production files only',
      ),
    ],
  },
  'E3-9': {
    scenario:
      'Handle teen tries to add an email or link Google: 403 scope-denied',
    evidence: [
      ev(
        SCOPE_METADATA,
        'a handle teen can never reach email-add, oauth-link, mfa, sessions, delete or export routes',
      ),
    ],
  },
  'E3-10': {
    scenario: 'Teen sends X-Acting-For: uniform 403',
    evidence: [
      ev(
        STRATEGY,
        'refuses X-Acting-For on a teen token with 403 ACTING_FOR_FORBIDDEN before any grant lookup',
      ),
      ev(
        E2E_SUPERVISED,
        'a teen token cannot send X-Acting-For (403 ACTING_FOR_FORBIDDEN)',
      ),
    ],
  },
  'E3-11': {
    scenario: 'Device token + X-Acting-For: rejected before the gate',
    evidence: [
      ev(
        STRATEGY,
        'X-Acting-For on a device token is 403 ACTING_FOR_FORBIDDEN, before the gate',
      ),
    ],
  },
  'E3-12': {
    scenario:
      'Device token on teen/adult/guardian routes, user token on device refresh: default deny, refresh never crosses kinds',
    evidence: [
      ev(SCOPE_METADATA, 'a device is denied with PRINCIPAL_SCOPE_DENIED'),
      ev(
        AUTH_SERVICE,
        'a user session never runs the device gate (adult regression)',
      ),
      ev(
        E2E_DEVICES,
        'refresh gives a DEVICE JWT (never an access one) and blacklists the old one',
      ),
    ],
  },
  'E3-13': {
    scenario:
      'Forged JWT (aud array, alg none, spoofed dev claim): 401 / user kind',
    evidence: [
      ev(
        STRATEGY,
        'a spoofed dev claim on an ACCESS token is ignored: the user kind comes from the server',
      ),
      ev(
        STRATEGY,
        'a guardian token that names BOTH audiences is rejected before anything is resolved',
      ),
      ev(
        E2E_DEVICES,
        'a forged token is rejected: wrong signature, alg none, audience array, both audiences',
      ),
    ],
  },
  'E3-14': {
    scenario:
      'Pairing token replay, expiry, double scan, N=1 race: one device, the rest uniform 400',
    evidence: [
      ev(
        PAIRING,
        'two phones racing for one token: the loser fails the compare-and-set, rolls back and gets the uniform 400',
      ),
      ev(
        PAIRING,
        'the device cap holds under the lock: a valid token on a child with 2 devices is 409 and the token is NOT consumed',
      ),
      ev(E2E_DEVICES, 'the token is single use: the replay is the uniform 400'),
    ],
  },
  'E3-15': {
    scenario:
      'Guardian revokes a device with most of its JWT left: next request 401',
    evidence: [
      ev(GATE_DEVICE, 'revoke is immediate (the epoch defeats the cache)'),
      ev(
        E2E_DEVICES,
        'A. pair -> device token -> allowed reads -> evidence -> notified -> revoke -> 401',
      ),
    ],
  },
  'E3-16': {
    scenario:
      'Pairing guardian leaves, the other stays: device revoked, other guardian told and can re-pair',
    evidence: [
      ev(
        E2E_DEVICES,
        'the pairing guardian leaves: their device is revoked (guardianship_revoked), the other guardian',
      ),
      ev(TRIGGERS, 'guardianship_revoked'),
    ],
  },
  'E3-17': {
    scenario:
      'Guardian deletes the account (acknowledge) with devices and a teen: devices revoked, teen pending_guardian, atomic',
    evidence: [
      ev(
        DELETION,
        'with the acknowledgment: detaches the dependents INSIDE the transaction, before anonymizing',
      ),
      ev(
        DELETION,
        'rolls back (account NOT deleted) when detaching a dependent fails',
      ),
      ev(
        LIFECYCLE,
        'outcome matrix when the LAST guardian of a teen (account holder) leaves',
      ),
    ],
  },
  'E3-18': {
    scenario:
      'Teen login enabled for a child with a device and guardian copies: device revoked, copies stop, acting ends',
    evidence: [
      ev(
        SUPERVISED,
        'revokes the linked devices through the port with teen_login_enabled, inside the transaction',
      ),
      ev(
        GATE_DEVICE,
        'an enabled supervised login ends the device (teen_login_enabled)',
      ),
      ev(
        PUSH_ROUTER,
        'a club push to a teen with an enabled login reaches no guardian',
      ),
    ],
  },
  'E3-19': {
    scenario:
      'Child turns 13 with a device: the device works, one nudge to the verified guardians',
    evidence: [
      ev(
        NUDGE_CRON,
        'never touches the devices of a child who turns 13 (it only nudges)',
      ),
      ev(
        NUDGE_CRON,
        'a dependent who turns 13 today gets ONE nudge to its verified guardian',
      ),
      ev(
        E2E_DEVICES,
        'the child turning 13 does NOT revoke an existing device',
      ),
    ],
  },
  'E3-20': {
    scenario:
      'Child turns 18 with a device or a handle login: device 401 the next calendar day, handle login keeps working as an adult',
    evidence: [
      ev(
        NUDGE_CRON,
        'a device whose child turned 18 today is revoked with reason majority',
      ),
      ev(
        GATE_DEVICE,
        'the day the child reaches the age of majority the device is refused (majority)',
      ),
      ev(RESOLVER, 'turns 18 at the country midnight, not at UTC midnight'),
    ],
  },
  'E3-21': {
    scenario: 'Dependent frozen / purged with devices: all revoked',
    evidence: [
      ev(GATE_DEVICE, 'a %s dependent ends the device (dependent_frozen)'),
      ev(
        PURGE_CRON,
        'a device revoke failure rolls the purge back (retried next run)',
      ),
    ],
  },
  'E3-22': {
    scenario:
      'Shared phone: the FCM token moves between guardian and child; revoke removes only the device rows',
    evidence: [
      ev(
        REVOCATION,
        'deactivates ONLY the token the device registered, and only while it still belongs to the child',
      ),
      ev(
        TRIGGERS,
        'a token that moved to another user is NOT deactivated by the revoke',
      ),
    ],
  },
  'E3-23': {
    scenario:
      'Club push to a device-paired child: device push + guardian labeled copy',
    evidence: [
      ev(
        PUSH_ROUTER,
        'DependentPushRouterService for a device-paired child (3b, FP3-48)',
      ),
      ev(
        PUSH_ROUTER,
        'two guardians with phones: ONE labeled push carrying both guardians',
      ),
    ],
  },
  'E3-24': {
    scenario: 'Club push to a handle teen: the teen only, no guardian copy',
    evidence: [
      ev(
        PUSH_ROUTER,
        'a club push to a teen with an enabled login reaches no guardian',
      ),
      ev(
        PUSH_ROUTER,
        'excludes frozen, purged, inactive and teens running their own login',
      ),
    ],
  },
  'E3-25': {
    scenario: 'Teen uploads evidence: no guardian push (the summary covers it)',
    evidence: [
      ev(
        GUARDIAN_NOTIFY,
        'does NOT notify when a supervised teen uploads their own evidence',
      ),
    ],
  },
  'E3-26': {
    scenario:
      'Device uploads evidence; the upload fails: a notice only on success',
    evidence: [
      ev(CLASSES, 'A rejected upload never reaches the guardians'),
      ev(
        GUARDIAN_NOTIFY,
        'notifies EVERY verified guardian even though the audit subject is the child',
      ),
    ],
  },
  'E3-27': {
    scenario:
      'Director creates a minor then verifies it: 403 CUSTODIAN_SELF_VERIFY, another person verifies',
    evidence: [
      ev(
        CONSENT_VERIFY,
        'the creator of the dependent cannot verify the custody: 403',
      ),
      ev(
        CONSENT_VERIFY,
        'another authorized person of the club verifies the custody (the uploader was someone else)',
      ),
      ev(
        E2E_DIRECTOR,
        'the CREATOR cannot verify (403 GUARDIANSHIP_CUSTODIAN_SELF_VERIFY) and nothing is written',
      ),
      ev(E2E_DIRECTOR, 'the verify-only reviewer (another person) verifies'),
    ],
  },
  'E3-28': {
    scenario:
      'Sole director, no coordinator: the request waits for an admin and expires at 30 days (a custodial minor is then frozen)',
    evidence: [
      ev(MR_SERVICE, 'expireStaleRequests: custodial minors (P3-A18)'),
      ev(
        MR_SERVICE,
        'the CREATOR of a director-created minor cannot approve while the custody consent is pending',
      ),
    ],
  },
  'E3-29': {
    scenario: 'The creator is also an admin: still blocked',
    evidence: [
      ev(
        CONSENT_VERIFY,
        'a creator who is also an admin is still blocked: the rule is by user id',
      ),
    ],
  },
  'E3-30': {
    scenario:
      'Parent claims a director-created minor: custodian revoked as claimed, must be verified again',
    evidence: [
      ev(
        LINK_CODES,
        'claims a 14-year-old: custody revoked as claimed, parent becomes PRIMARY non-custodian PENDING, nothing inherited',
      ),
      ev(E2E_DIRECTOR, 'the parent redeems it: custody is revoked as'),
      ev(E2E_DIRECTOR, 'the ORIGINAL CREATOR may verify it'),
    ],
  },
  'E3-31': {
    scenario:
      'Verify and revoke race on a teen: serialized per dependent lock, no orphan verified row',
    evidence: [
      ev(CONSENT_RACE, 'verify-consent vs the only guardian leaving (E9)'),
      ev(
        CONSENT_RACE,
        'the leave lands first: the verification meets the custody row (no form yet) and writes nothing',
      ),
    ],
  },
  'E3-32': {
    scenario:
      'Legal bump: adult, teen, guardian with 2 dependents, device: hard gate each; the guardian accepts per dependent; the device waits',
    evidence: [
      ev(
        LEGAL_CONTROLLER,
        'POST while acting records the guardian (actor_sub) as the one who accepted',
      ),
      ev(
        SCOPE_METADATA,
        'the device cannot read health data, change the password, accept legal terms or touch profiles',
      ),
      ev(
        'src/legal/legal.service.spec.ts',
        'are 2.0.0-family for both documents and fit the 32-char column',
      ),
    ],
  },
  'E3-33': {
    scenario:
      'Teen with MFA enrolled: the second factor completes, the MFA routes are denied afterwards',
    evidence: [
      ev(
        ACTING_GUARDS,
        'lets an aal1 teen reach the @SkipMfaCheck route that completes the second factor, but nothing else',
      ),
      ev(
        SCOPE_METADATA,
        'a handle teen can never reach email-add, oauth-link, mfa, sessions, delete or export routes',
      ),
    ],
  },
  'E3-34': {
    scenario:
      'Teen signs in with Google / Apple: same supervised_user kind and scopes',
    evidence: [
      ev(
        STRATEGY,
        'gives password, social and refresh tokens the same kind (no claim is involved)',
      ),
    ],
  },
  'E3-35': {
    scenario: 'NULL birthday user: kind user, activation fails closed',
    evidence: [
      ev(
        RESOLVER,
        'NULL birthday + post-registration complete = adult (legacy accounts)',
      ),
      ev(GATE_DEVICE, 'a NULL birthday cannot prove a minor: fail closed'),
      ev(GATE, 'NULL birthday'),
    ],
  },
  'E3-36': {
    scenario:
      'Country with majority 16 / minSelfLoginAge 16: every range follows the policy',
    evidence: [
      ev(RESOLVER, 'follows the country policy (majority 16)'),
      ev(SUMMARY, 'follows the country majority (16)'),
      ev(SUPERVISED, 'follows the country policy (min age 16)'),
      ev(
        NUDGE_CRON,
        'follows the country policy: majority 16 stops the nudge at 16',
      ),
    ],
  },
  'E3-37': {
    scenario:
      'Redis down: falls back to the DB, login limits conservative; DB down is a 503',
    evidence: [
      ev(GATE_DEVICE, 'a cache outage falls back to the database'),
      ev(
        GATE_DEVICE,
        'a database failure is 503 AUTH_REVOCATION_CHECK_UNAVAILABLE, never fail-open',
      ),
      ev(LOGIN_COUNTER, 'LoginFailureCounter with Redis errors'),
    ],
  },
  'E3-38': {
    scenario:
      'Flags off: the hole stays closed, handle login is the uniform 401, devices 401',
    evidence: [
      ev(
        BETTER_AUTH,
        'with FAMILY_TEEN_LOGIN_ENABLED off a handle is the uniform 401 even with the right password',
      ),
      ev(GATE_DEVICE, 'flag off: 401 AUTH_DEVICE_REVOKED without any lookup'),
      ev(
        E2E_DEVICES,
        'off: existing device tokens are 401 AUTH_DEVICE_REVOKED, pairing is the uniform 400',
      ),
      ev(
        E2E_DIRECTOR,
        'is a 404 while FAMILY_DIRECTOR_CREATE_MINOR_ENABLED is off',
      ),
    ],
  },
  'E3-39': {
    scenario:
      'Last guardian of a teen leaves (assignment vs none): custody vs pending_guardian, never frozen immediately',
    evidence: [
      ev(
        LIFECYCLE,
        'no club assignment: pending_guardian, NEVER frozen, the guardian-less clock restarts',
      ),
      ev(
        LIFECYCLE,
        'with an active/pending club assignment: club_custody, and the teen is still pending',
      ),
    ],
  },
  'E3-40': {
    scenario: '11th pairing token / 11th teen code / 6th reset in an hour: 429',
    evidence: [
      ev(
        'src/guardianships/dependent-action-limiter.spec.ts',
        'allows the limit and answers 429 on the next hit, with the wait',
      ),
      ev(SUPERVISED, 'is limited to 5 per hour PER DEPENDENT'),
      ev(
        'src/guardianships/teen-link-codes.controller.spec.ts',
        'throttles issuing to 10 per hour on every configured throttler',
      ),
      ev(PAIRING, 'abuse limits'),
    ],
  },
  'E3-41': {
    scenario:
      'Summary for a revoked / pending / foreign guardian: 404 / 409 / 404, no health data ever',
    evidence: [
      ev(
        SUMMARY,
        'a stranger or the guardian of another child is 404 GUARDIANSHIP_NOT_FOUND',
      ),
      ev(
        SUMMARY,
        'a PENDING guardian is 409 GUARDIANSHIP_CONSENT_NOT_VERIFIED and nothing is read',
      ),
      ev(
        SUMMARY,
        'never contains health, evidence, notes, contact, location or message keys',
      ),
    ],
  },
  'E3-42': {
    scenario:
      'Admin disables a login / revokes a device: immediate, reason mandatory, guardians notified',
    evidence: [
      ev(
        'src/admin/admin-family-access.service.spec.ts',
        'checks the actor territory BEFORE cutting anything',
      ),
      ev('src/admin/dto/family-access.dto.spec.ts', 'rejects %s'),
      ev(
        E2E_DIRECTOR,
        "the teen's very next request is 401 AUTH_SUPERVISED_ACCESS_REVOKED",
      ),
      ev(
        E2E_DIRECTOR,
        "the device's very next request is 401 AUTH_DEVICE_REVOKED",
      ),
      ev(E2E_DIRECTOR, 'every verified guardian is told'),
    ],
  },
};

const ROOT = join(__dirname, '..', '..');
const normalize = (text: string): string => text.replace(/\s+/g, ' ');
const cache = new Map<string, string>();
const read = (file: string): string | null => {
  if (!cache.has(file)) {
    try {
      cache.set(file, normalize(readFileSync(join(ROOT, file), 'utf8')));
    } catch {
      return null;
    }
  }
  return cache.get(file) ?? null;
};

describe('family profiles phase 3: edge-case matrix E3-1..E3-42', () => {
  it('has every row from E3-1 to E3-42, none missing and none extra', () => {
    const expected = Array.from({ length: 42 }, (_v, i) => `E3-${i + 1}`);
    expect(Object.keys(EDGE_MATRIX).sort()).toEqual([...expected].sort());
  });

  it.each(Object.entries(EDGE_MATRIX))(
    '%s names at least one test and every named test still exists',
    (id, row) => {
      expect({ id, evidence: row.evidence.length > 0 }).toEqual({
        id,
        evidence: true,
      });
      const problems: string[] = [];
      for (const { file, phrase } of row.evidence) {
        const content = read(file);
        if (content === null) {
          problems.push(`${file}: file not found`);
        } else if (!content.includes(normalize(phrase))) {
          problems.push(`${file}: missing "${phrase}"`);
        }
      }
      expect({ id, problems }).toEqual({ id, problems: [] });
    },
  );

  it('does not name the same evidence twice inside a row', () => {
    for (const [id, row] of Object.entries(EDGE_MATRIX)) {
      const keys = row.evidence.map((e) => `${e.file}::${e.phrase}`);
      expect({ id, unique: new Set(keys).size }).toEqual({
        id,
        unique: keys.length,
      });
    }
  });

  // -------------------------------------------------------------------------
  // E3-8: the handle inventory (this row had no test for search / QR / lists)
  // -------------------------------------------------------------------------

  describe('E3-8 handle exposure', () => {
    /**
     * The ONLY production files that may mention `login_handle`, and why. The
     * handle is shown to a VERIFIED guardian (and to an admin with the
     * sensitive permission) and is scrubbed by the log redactors; any other
     * endpoint (user search, QR card, member lists, dashboards) that starts
     * selecting it must be added here on purpose, in review.
     */
    const ALLOWED: Record<string, string> = {
      'src/guardianships/supervised-logins.service.ts':
        'creates, views and clears the handle for the verified guardian',
      'src/guardianships/guardianships.service.ts':
        'dependent summary: the handle only for a VERIFIED guardian',
      'src/guardianships/guardianships.types.ts': 'the summary type',
      'src/guardianships/guardian-security-notifications.service.ts':
        'resolves a locked handle to the teen, never echoes it',
      'src/guardianships/dependent-profiles-purge-cron.service.ts':
        'nulls the handle when the account is purged',
      'src/admin/admin-users.service.ts':
        'family_access block for readers of the legal_representative family',
      'src/better-auth/better-auth.service.ts':
        'looks the handle up at login (lowercased), never returns it',
      'src/main.ts': 'request-body redaction list',
      'src/common/filters/http-exception.filter.ts':
        'error-body redaction list',
      'src/common/interceptors/sentry.interceptor.ts':
        'Sentry payload redaction list',
    };

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return walk(full);
        return full.endsWith('.ts') &&
          !full.endsWith('.spec.ts') &&
          !full.endsWith('.testing.ts')
          ? [full]
          : [];
      });

    it('the login handle is read by an allowlisted set of production files only', () => {
      const mentioning = walk(join(ROOT, 'src'))
        .filter((file) => readFileSync(file, 'utf8').includes('login_handle'))
        .map((file) => relative(ROOT, file))
        .sort();

      expect(mentioning).toEqual(Object.keys(ALLOWED).sort());
    });

    it('no user search, QR card, member list or catalog module touches it', () => {
      const offenders = Object.keys(ALLOWED).filter((file) =>
        /\/(users|qr|clubs|members|search|catalogs|dashboard|units|activities)\//.test(
          file,
        ),
      );
      expect(offenders).toEqual([]);
    });
  });
});
