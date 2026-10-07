import { readFileSync } from 'fs';
import { join } from 'path';
import { ErrorCode } from '../common/errors/error-codes';

const LOCALES = ['es', 'en', 'fr', 'pt-BR'];

function load(locale: string, file: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'src', 'i18n', locale, file), 'utf8'),
  ) as Record<string, unknown>;
}

describe('club role eligibility i18n parity', () => {
  it.each(LOCALES)('declares the eligibility error codes in %s', (locale) => {
    const errors = load(locale, 'errors.json') as Record<string, string>;
    for (const code of [
      ErrorCode.CLUB_ROLE_GUIDE_MAJOR_REQUIRED,
      ErrorCode.CLUB_ROLE_MEMBER_REQUIRES_GUIDE_MAJOR_SECTION,
      ErrorCode.CLASS_COUNSELOR_GUIDE_MAJOR_REQUIRED,
    ]) {
      expect(errors[code]).toBeTruthy();
    }
  });

  it.each(LOCALES)(
    'declares the year-cut skipped-plan texts in %s',
    (locale) => {
      const notifications = load(locale, 'notifications.json') as {
        notifications: { year_cut: Record<string, string> };
      };
      expect(
        notifications.notifications.year_cut.director_plan_skipped_title,
      ).toBeTruthy();
      expect(
        notifications.notifications.year_cut.director_plan_skipped_body,
      ).toContain('{code}');
    },
  );
});
