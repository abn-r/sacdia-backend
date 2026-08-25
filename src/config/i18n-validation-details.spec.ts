import { shouldExposeI18nValidationDetails } from './i18n-validation-details';

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
