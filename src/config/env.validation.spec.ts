import { envValidationSchema } from './env.validation';

const validBaseEnv = {
  DATABASE_URL: 'postgresql://user:password@example.com:5432/sacdia',
  BETTER_AUTH_SECRET: 'a-secure-test-secret-that-is-32-chars',
  R2_BUCKET_HONORS_PDF: 'honors-pdf',
  R2_PUBLIC_URL_HONORS_PDF: 'https://storage.example.com/honors',
  R2_BUCKET_EVIDENCE_FILES: 'evidence-files',
  R2_PUBLIC_URL_EVIDENCE_FILES: 'https://storage.example.com/evidence',
  R2_BUCKET_INSURANCE_EVIDENCE: 'insurance-evidence',
  R2_PUBLIC_URL_INSURANCE_EVIDENCE:
    'https://storage.example.com/insurance',
  R2_BUCKET_DATA_EXPORTS: 'data-exports',
  R2_PUBLIC_URL_DATA_EXPORTS: 'https://storage.example.com/exports',
  R2_BUCKET_RESOURCES_FILES: 'resources',
  R2_PUBLIC_URL_RESOURCES_FILES: 'https://storage.example.com/resources',
};

function validate(overrides: Record<string, unknown> = {}) {
  return envValidationSchema.validate(
    {
      ...validBaseEnv,
      ...overrides,
    },
    { abortEarly: false },
  );
}

describe('envValidationSchema email configuration', () => {
  it('allows Resend configuration to be omitted when email is disabled', () => {
    const { error } = validate({ EMAIL_ENABLED: 'false' });

    expect(error).toBeUndefined();
  });

  it('accepts a complete Resend configuration when email is enabled', () => {
    const { error } = validate({
      EMAIL_ENABLED: 'true',
      RESEND_API_KEY: 're_test_backend_key',
      RESEND_FROM_EMAIL: 'SACDIA <contacto@sacdia.com>',
      RESEND_REPLY_TO: 'contacto@sacdia.com',
    });

    expect(error).toBeUndefined();
  });

  it('requires the Resend API key when email is enabled', () => {
    const { error } = validate({
      EMAIL_ENABLED: 'true',
      RESEND_FROM_EMAIL: 'SACDIA <contacto@sacdia.com>',
    });

    expect(error?.message).toContain('RESEND_API_KEY');
  });

  it('rejects a placeholder Resend API key when email is enabled', () => {
    const { error } = validate({
      EMAIL_ENABLED: 'true',
      RESEND_API_KEY: 're_<api-key>',
      RESEND_FROM_EMAIL: 'SACDIA <contacto@sacdia.com>',
    });

    expect(error?.message).toContain('RESEND_API_KEY');
  });

  it('requires the From header when email is enabled', () => {
    const { error } = validate({
      EMAIL_ENABLED: 'true',
      RESEND_API_KEY: 're_test_backend_key',
    });

    expect(error?.message).toContain('RESEND_FROM_EMAIL');
  });

  it('rejects an invalid mailbox in the From header', () => {
    const { error } = validate({
      EMAIL_ENABLED: 'true',
      RESEND_API_KEY: 're_test_backend_key',
      RESEND_FROM_EMAIL: 'SACDIA <not-an-email>',
    });

    expect(error?.message).toContain('RESEND_FROM_EMAIL');
  });

  it('rejects an invalid Reply-To address', () => {
    const { error } = validate({
      EMAIL_ENABLED: 'true',
      RESEND_API_KEY: 're_test_backend_key',
      RESEND_FROM_EMAIL: 'contacto@sacdia.com',
      RESEND_REPLY_TO: 'not-an-email',
    });

    expect(error?.message).toContain('RESEND_REPLY_TO');
  });
});
