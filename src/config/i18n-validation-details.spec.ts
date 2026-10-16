import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { I18nValidationException, I18nValidationPipe } from 'nestjs-i18n';
import { RegisterDto } from '../auth/dto/register.dto';
import {
  GLOBAL_VALIDATION_PIPE_OPTIONS,
  shouldExposeI18nValidationDetails,
} from './i18n-validation-details';

describe('GLOBAL_VALIDATION_PIPE_OPTIONS', () => {
  it('never echoes the request body or field values in validation errors', async () => {
    const pipe = new I18nValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const password = 'EchoCheck#123';

    const error = await pipe
      .transform(
        {
          name: 'QA',
          paternal_last_name: 'Legal',
          maternal_last_name: 'Prueba',
          email: 'qa.echo@example.com',
          password,
          unexpected_field: 'echo-me-not',
        },
        { type: 'body', metatype: RegisterDto },
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(I18nValidationException);
    const errors = (error as I18nValidationException).errors;
    expect(errors.length).toBeGreaterThan(0);
    for (const e of errors) {
      expect(e.target).toBeUndefined();
      expect(e.value).toBeUndefined();
    }
    // Constraint messages still carry `key|{"value":...}` until the
    // I18nValidationExceptionFilter translates them; only the error objects
    // themselves must be free of the rejected input.
    const withoutConstraints = errors.map(
      ({ constraints: _c, ...rest }) => rest,
    );
    expect(JSON.stringify(withoutConstraints)).not.toContain(password);
    expect(JSON.stringify(withoutConstraints)).not.toContain('echo-me-not');
  });

  it('keeps every validation translation free of the {value} placeholder', () => {
    // The filter interpolates translations with the rejected value; a {value}
    // placeholder in any errors.json would echo input such as passwords.
    const i18nDir = join(__dirname, '..', 'i18n');
    const locales = readdirSync(i18nDir, { withFileTypes: true }).filter((d) =>
      d.isDirectory(),
    );
    expect(locales.length).toBeGreaterThan(0);
    for (const locale of locales) {
      const errorsPath = join(i18nDir, locale.name, 'errors.json');
      expect(readFileSync(errorsPath, 'utf8')).not.toMatch(
        /\{\{?\s*value\s*\}?\}/,
      );
    }
  });
});

describe('shouldExposeI18nValidationDetails', () => {
  it('hides the validation tree in production', () => {
    expect(shouldExposeI18nValidationDetails('production')).toBe(false);
  });

  it.each(['development', 'test', undefined, ''])(
    'exposes the validation tree when NODE_ENV is %s',
    (nodeEnv) => {
      expect(shouldExposeI18nValidationDetails(nodeEnv)).toBe(true);
    },
  );
});
