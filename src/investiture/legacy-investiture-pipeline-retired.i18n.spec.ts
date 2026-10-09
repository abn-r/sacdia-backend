import { readFileSync } from 'fs';
import { join } from 'path';
import { ErrorCode } from '../common/errors/error-codes';

describe('legacy investiture pipeline retirement i18n', () => {
  it.each(['es', 'en', 'fr', 'pt-BR'])(
    'declares INVESTITURE_LEGACY_PIPELINE_RETIRED in %s',
    (locale) => {
      const errors = JSON.parse(
        readFileSync(
          join(process.cwd(), 'src', 'i18n', locale, 'errors.json'),
          'utf8',
        ),
      ) as Record<string, string>;
      expect(
        errors[ErrorCode.INVESTITURE_LEGACY_PIPELINE_RETIRED],
      ).toBeTruthy();
    },
  );

  // Códigos que solo usaba la cadena anterior; ya nada los lanza.
  const RETIRED_CODES = [
    'INVESTITURE_INVALID_STATE_TRANSITION',
    'INVESTITURE_ALREADY_INVESTIDO',
    'INVESTITURE_REJECT_COMMENTS_REQUIRED',
    'INVESTITURE_FIELD_APPROVE_REQUIRES_ADMIN',
    'INVESTITURE_CONFIG_NOT_FOUND',
    'INVESTITURE_CONFIG_DUPLICATE',
    'INVESTITURE_CONCURRENT_UPDATE',
    'INVESTITURE_REQUIREMENTS_INCOMPLETE',
  ];

  it('no longer exposes the error codes only the old pipeline used', () => {
    expect(
      RETIRED_CODES.filter((code) => code in (ErrorCode as object)),
    ).toEqual([]);
  });

  it.each(['es', 'en', 'fr', 'pt-BR'])(
    'keeps no message for the retired old-pipeline codes in %s',
    (locale) => {
      const errors = JSON.parse(
        readFileSync(
          join(process.cwd(), 'src', 'i18n', locale, 'errors.json'),
          'utf8',
        ),
      ) as Record<string, string>;
      expect(RETIRED_CODES.filter((code) => code in errors)).toEqual([]);
    },
  );
});
