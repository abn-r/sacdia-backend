import { envValidationSchema } from './env.validation';

const validBaseEnv = {
  DATABASE_URL: 'postgresql://user:password@example.com:5432/sacdia',
  BETTER_AUTH_SECRET: 'a-secure-test-secret-that-is-32-chars',
  QR_JWT_SECRET: 'a-distinct-qr-secret-that-is-32ch',
  R2_BUCKET_HONORS_PDF: 'honors-pdf',
  R2_PUBLIC_URL_HONORS_PDF: 'https://storage.example.com/honors',
  R2_BUCKET_EVIDENCE_FILES: 'evidence-files',
  R2_PUBLIC_URL_EVIDENCE_FILES: 'https://storage.example.com/evidence',
  R2_BUCKET_INSURANCE_EVIDENCE: 'insurance-evidence',
  R2_PUBLIC_URL_INSURANCE_EVIDENCE: 'https://storage.example.com/insurance',
  R2_BUCKET_DATA_EXPORTS: 'data-exports',
  R2_PUBLIC_URL_DATA_EXPORTS: 'https://storage.example.com/exports',
  R2_BUCKET_MONTHLY_REPORTS: 'monthly-reports',
  R2_PUBLIC_URL_MONTHLY_REPORTS: 'https://storage.example.com/monthly-reports',
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
      REDIS_URL: 'rediss://default:test-password@redis.example.com:6379',
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
      REDIS_URL: 'rediss://default:test-password@redis.example.com:6379',
    });

    expect(error?.message).toContain('RESEND_REPLY_TO');
  });

  it('requires Redis when email is enabled', () => {
    const { error } = validate({
      EMAIL_ENABLED: 'true',
      RESEND_API_KEY: 're_test_backend_key',
      RESEND_FROM_EMAIL: 'SACDIA <contacto@sacdia.com>',
    });

    expect(error?.message).toContain('REDIS_URL');
  });

  it('rejects a placeholder Redis URL when email is enabled', () => {
    const { error } = validate({
      EMAIL_ENABLED: 'true',
      RESEND_API_KEY: 're_test_backend_key',
      RESEND_FROM_EMAIL: 'SACDIA <contacto@sacdia.com>',
      REDIS_URL:
        'rediss://default:YOUR_PASSWORD@YOUR_REGION.redis.example.com:6379',
    });

    expect(error?.message).toContain('REDIS_URL');
  });
});

describe('QR JWT secret validation', () => {
  it('requires QR_JWT_SECRET', () => {
    const { error } = validate({ QR_JWT_SECRET: undefined });

    expect(error?.message).toContain('QR_JWT_SECRET');
  });

  it('rejects QR_JWT_SECRET when it matches BETTER_AUTH_SECRET', () => {
    const { error } = validate({
      QR_JWT_SECRET: 'a-secure-test-secret-that-is-32-chars',
    });

    expect(error?.message).toContain('QR_JWT_SECRET');
  });
});

describe('infrastructure environment validation', () => {
  it('applies bounded positive defaults for PostgreSQL pool settings', () => {
    expect(
      envValidationSchema.extract('PRISMA_POOL_MAX').validate(undefined),
    ).toMatchObject({ value: 20 });
    expect(
      envValidationSchema
        .extract('PRISMA_POOL_IDLE_TIMEOUT_MS')
        .validate(undefined),
    ).toMatchObject({ value: 300_000 });
    expect(
      envValidationSchema.extract('PRISMA_POOL_MAX').validate(0).error,
    ).toBeDefined();
    expect(
      envValidationSchema.extract('PRISMA_POOL_MAX').validate(101).error,
    ).toBeDefined();
  });

  it('validates cache TTL and Redis connection timeout as positive integers', () => {
    expect(
      envValidationSchema.extract('CACHE_DEFAULT_TTL_MS').validate(undefined),
    ).toMatchObject({ value: 86_400_000 });
    expect(
      envValidationSchema
        .extract('CACHE_REDIS_CONNECTION_TIMEOUT_MS')
        .validate(undefined),
    ).toMatchObject({ value: 5_000 });
    expect(
      envValidationSchema.extract('CACHE_DEFAULT_TTL_MS').validate(-1).error,
    ).toBeDefined();
  });

  it('only accepts Redis-compatible URL schemes', () => {
    expect(
      validate({ REDIS_URL: 'rediss://default:secret@cache.example.com' })
        .error,
    ).toBeUndefined();
    expect(
      validate({ REDIS_URL: 'https://cache.example.com' }).error,
    ).toBeDefined();
  });
});

describe('production hardening validation', () => {
  const productionEnv = {
    NODE_ENV: 'production',
    ALLOWED_ORIGINS: 'https://app.sacdia.app,https://admin.sacdia.app',
  };

  it('requires ALLOWED_ORIGINS in production', () => {
    const { error } = validate({ NODE_ENV: 'production' });

    expect(error?.message).toContain('ALLOWED_ORIGINS');
  });

  it('accepts a production config with explicit origins', () => {
    const { error } = validate(productionEnv);

    expect(error).toBeUndefined();
  });

  it('does not require ALLOWED_ORIGINS outside production', () => {
    const { error } = validate({ NODE_ENV: 'development' });

    expect(error).toBeUndefined();
  });

  it('rejects SWAGGER_ENABLED=true in production', () => {
    const { error } = validate({
      ...productionEnv,
      SWAGGER_ENABLED: 'true',
    });

    expect(error?.message).toContain('SWAGGER_ENABLED');
  });

  it('allows SWAGGER_ENABLED=false in production', () => {
    const { error } = validate({
      ...productionEnv,
      SWAGGER_ENABLED: 'false',
    });

    expect(error).toBeUndefined();
  });

  it('allows SWAGGER_ENABLED=true outside production', () => {
    const { error } = validate({ SWAGGER_ENABLED: 'true' });

    expect(error).toBeUndefined();
  });
});

describe('trust proxy hops environment validation', () => {
  it('allows TRUST_PROXY_HOPS to be omitted or 0–5', () => {
    expect(validate().error).toBeUndefined();
    expect(validate({ TRUST_PROXY_HOPS: 0 }).error).toBeUndefined();
    expect(validate({ TRUST_PROXY_HOPS: 1 }).error).toBeUndefined();
    expect(validate({ TRUST_PROXY_HOPS: 5 }).error).toBeUndefined();
  });

  it.each([-1, 6, 1.5, 'true'])(
    'rejects TRUST_PROXY_HOPS=%s',
    (TRUST_PROXY_HOPS) => {
      expect(validate({ TRUST_PROXY_HOPS }).error).toBeDefined();
    },
  );
});

describe('certificate import file host allowlist', () => {
  it('allows CERTIFICATE_IMPORT_ALLOWED_FILE_HOSTS to be omitted or empty', () => {
    expect(validate().error).toBeUndefined();
    expect(
      validate({ CERTIFICATE_IMPORT_ALLOWED_FILE_HOSTS: '' }).error,
    ).toBeUndefined();
    expect(
      validate({
        CERTIFICATE_IMPORT_ALLOWED_FILE_HOSTS: 'files.sacdia.app,cdn.example',
      }).error,
    ).toBeUndefined();
  });
});

describe('timezone bootstrap environment validation', () => {
  it.each(['development', 'test'])(
    'permits bootstrap only in %s',
    (NODE_ENV) => {
      expect(
        validate({ NODE_ENV, DEV_LOCAL_FIELD_TIMEZONE_BOOTSTRAP: 'true' })
          .error,
      ).toBeUndefined();
    },
  );

  it('rejects timezone bootstrap in production, including false-like values', () => {
    for (const value of ['true', 'false']) {
      expect(
        validate({
          NODE_ENV: 'production',
          DEV_LOCAL_FIELD_TIMEZONE_BOOTSTRAP: value,
        }).error?.message,
      ).toContain('DEV_LOCAL_FIELD_TIMEZONE_BOOTSTRAP');
    }
  });
});
