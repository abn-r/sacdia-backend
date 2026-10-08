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
      expect(errors[ErrorCode.INVESTITURE_LEGACY_PIPELINE_RETIRED]).toBeTruthy();
    },
  );
});
