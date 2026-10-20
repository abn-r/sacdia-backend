import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCode } from './error-codes';

const LOCALES = ['es', 'en', 'fr', 'pt-BR'] as const;

/** Codes introduced by family profiles phase 3a (each needs the 4 locales). */
const PHASE_3A_CODES: ErrorCode[] = [
  ErrorCode.PRINCIPAL_SCOPE_DENIED,
  ErrorCode.AUTH_SUPERVISED_ACCESS_REVOKED,
  ErrorCode.AUTH_SUPERVISED_LOGIN_DISABLED,
  ErrorCode.AUTH_ACCOUNT_FROZEN,
  ErrorCode.AUTH_LOGIN_LOCKED,
  ErrorCode.USER_BIRTHDAY_CHANGE_REQUIRES_GUARDIAN,
  ErrorCode.SUPERVISED_LOGIN_NOT_ELIGIBLE,
  ErrorCode.SUPERVISED_LOGIN_ALREADY_ENABLED,
  ErrorCode.SUPERVISED_LOGIN_NOT_FOUND,
  ErrorCode.SUPERVISED_LOGIN_EMAIL_UNAVAILABLE,
  ErrorCode.SUPERVISED_LOGIN_PASSWORD_INVALID,
  ErrorCode.GUARDIANSHIP_CONSENT_NOT_VERIFIED,
  ErrorCode.FAMILY_FEATURE_DISABLED,
];

/** Codes introduced by family profiles phase 3b (each needs the 4 locales). */
const PHASE_3B_CODES: ErrorCode[] = [
  ErrorCode.AUTH_DEVICE_REVOKED,
  ErrorCode.AUTH_DEVICE_SESSION_EXPIRED,
  ErrorCode.DEVICE_PAIRING_TOKEN_INVALID,
  ErrorCode.DEVICE_PAIRING_NOT_ELIGIBLE,
  ErrorCode.DEVICE_LIMIT_REACHED,
  ErrorCode.DEVICE_NOT_FOUND,
];

/** Codes introduced by family profiles phase 3c (each needs the 4 locales). */
const PHASE_3C_CODES: ErrorCode[] = [ErrorCode.MR_APPROVE_PERMISSION_REQUIRED];

const load = (locale: string): Record<string, string> =>
  JSON.parse(
    readFileSync(join(__dirname, `../../i18n/${locale}/errors.json`), 'utf8'),
  ) as Record<string, string>;

describe('phase 3a error codes i18n parity', () => {
  it.each(LOCALES)('every phase 3a code has a message in %s', (locale) => {
    const catalog = load(locale);
    const missing = PHASE_3A_CODES.filter((code) => !catalog[code]?.trim());
    expect(missing).toEqual([]);
  });
});

describe('phase 3b error codes i18n parity', () => {
  it.each(LOCALES)('every phase 3b code has a message in %s', (locale) => {
    const catalog = load(locale);
    const missing = PHASE_3B_CODES.filter((code) => !catalog[code]?.trim());
    expect(missing).toEqual([]);
  });
});

describe('phase 3c error codes i18n parity', () => {
  it.each(LOCALES)('every phase 3c code has a message in %s', (locale) => {
    const catalog = load(locale);
    const missing = PHASE_3C_CODES.filter((code) => !catalog[code]?.trim());
    expect(missing).toEqual([]);
  });
});
