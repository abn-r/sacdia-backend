import * as Joi from 'joi';
import { isPlaceholderUrl } from './bullmq.config';

const RESEND_API_KEY_PLACEHOLDER = 're_<api-key>';
const FROM_ADDRESS_PATTERN =
  /^(?:[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+|[^<>\r\n]+<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>)$/;

const resendApiKeySchema = Joi.string()
  .trim()
  .min(1)
  .invalid(RESEND_API_KEY_PLACEHOLDER)
  .when('EMAIL_ENABLED', {
    is: 'true',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  });

const resendFromEmailSchema = Joi.string()
  .trim()
  .pattern(FROM_ADDRESS_PATTERN)
  .when('EMAIL_ENABLED', {
    is: 'true',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  })
  .messages({
    'string.pattern.base':
      '{{#label}} must be an email or a display name followed by <email>',
  });

const redisUrlSchema = Joi.string()
  .trim()
  .uri({ scheme: ['redis', 'rediss'] })
  .custom((value: string, helpers) => {
    if (isPlaceholderUrl(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'Redis URL placeholder validation')
  .when('EMAIL_ENABLED', {
    is: 'true',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  });

export const envValidationSchema = Joi.object({
  // Database (required)
  DATABASE_URL: Joi.string().uri().required(),
  DATABASE_DIRECT_URL: Joi.string().uri().optional(),
  DATABASE_APPLICATION_NAME: Joi.string()
    .trim()
    .max(63)
    .default('sacdia-backend'),
  PRISMA_POOL_MAX: Joi.number().integer().min(1).max(100).default(20),
  PRISMA_POOL_IDLE_TIMEOUT_MS: Joi.number().integer().positive().default(30000),
  PRISMA_POOL_CONNECTION_TIMEOUT_MS: Joi.number()
    .integer()
    .positive()
    .default(15000),
  PRISMA_POOL_KEEP_ALIVE_INITIAL_DELAY_MS: Joi.number()
    .integer()
    .positive()
    .default(10000),

  // Better Auth (required)
  BETTER_AUTH_SECRET: Joi.string().min(32).required(),
  BETTER_AUTH_BASE_URL: Joi.string().uri().optional(),

  // App
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DEV_LOCAL_FIELD_TIMEZONE_BOOTSTRAP: Joi.string()
    .valid('true', 'false')
    .when('NODE_ENV', { is: 'production', then: Joi.forbidden() })
    .optional(),
  FRONTEND_URL: Joi.string().uri().optional(),
  ALLOWED_ORIGINS: Joi.string().optional(),
  AUTH_REJECT_SNAKE_CASE: Joi.boolean().default(false),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').optional(),
  // Email feature flag — defaults to false (fail-safe: emails OFF unless explicitly enabled).
  // Checked as process.env.EMAIL_ENABLED === 'true' in auth.service.ts and better-auth.service.ts.
  EMAIL_ENABLED: Joi.string().valid('true', 'false').default('false'),

  // Resend (transactional email transport)
  // API key and sender are required only while email delivery is enabled.
  RESEND_API_KEY: resendApiKeySchema,
  // Display name + sender address. Example: "SACDIA <contacto@sacdia.com>"
  RESEND_FROM_EMAIL: resendFromEmailSchema,
  // Reply-To address shown to recipients (e.g. contacto@sacdia.com)
  RESEND_REPLY_TO: Joi.string().email().allow('').optional(),
  REQUEST_TIMEOUT_MS: Joi.number().integer().positive().optional(),

  // Logging
  LOG_LEVEL: Joi.string().valid('debug', 'info', 'warn', 'error').optional(),
  LOG_PRETTY: Joi.boolean().optional(),
  LOG_PRETTY_IGNORE: Joi.string().optional(),

  // Redis
  REDIS_URL: redisUrlSchema,
  CACHE_DEFAULT_TTL_MS: Joi.number().integer().positive().default(86400000),
  CACHE_REDIS_CONNECTION_TIMEOUT_MS: Joi.number()
    .integer()
    .positive()
    .default(5000),
  // Authorization cache v4 rollout — default ON (R05 read-path). Set "false" to
  // omit Redis cache and load only from the canonical source (operational rollback).
  AUTH_CONTEXT_CACHE_V4_ENABLED: Joi.string()
    .valid('true', 'false')
    .default('true'),

  // Cloudflare R2
  R2_ACCOUNT_ID: Joi.string().optional(),
  R2_ACCESS_KEY_ID: Joi.string().optional(),
  R2_SECRET_ACCESS_KEY: Joi.string().optional(),
  R2_REGION: Joi.string().optional(),
  R2_SIGNED_URL_EXPIRES_SECONDS: Joi.number().integer().positive().optional(),

  R2_BUCKET_USER_PROFILES: Joi.string().optional(),
  R2_PUBLIC_URL_USER_PROFILES: Joi.string().uri().optional(),
  R2_KEY_PREFIX_USER_PROFILES: Joi.string().allow('').optional(),

  R2_BUCKET_USERS_HONORS: Joi.string().optional(),
  R2_PUBLIC_URL_USERS_HONORS: Joi.string().uri().optional(),
  R2_KEY_PREFIX_USERS_HONORS: Joi.string().allow('').optional(),

  R2_BUCKET_USERS_HONORS_CERT: Joi.string().optional(),
  R2_PUBLIC_URL_USERS_HONORS_CERT: Joi.string().uri().optional(),
  R2_KEY_PREFIX_USERS_HONORS_CERT: Joi.string().allow('').optional(),

  R2_BUCKET_ACTIVITIES_IMAGES: Joi.string().optional(),
  R2_PUBLIC_URL_ACTIVITIES_IMAGES: Joi.string().uri().optional(),
  R2_KEY_PREFIX_ACTIVITIES_IMAGES: Joi.string().allow('').optional(),

  R2_BUCKET_HONORS_IMAGES: Joi.string().optional(),
  R2_PUBLIC_URL_HONORS_IMAGES: Joi.string().uri().optional(),
  R2_KEY_PREFIX_HONORS_IMAGES: Joi.string().allow('').optional(),

  R2_BUCKET_HONORS_PDF: Joi.string().required(),
  R2_PUBLIC_URL_HONORS_PDF: Joi.string().uri().required(),
  R2_KEY_PREFIX_HONORS_PDF: Joi.string().allow('').optional(),

  R2_BUCKET_CLASSES_DOCUMENTS: Joi.string().optional(),
  R2_PUBLIC_URL_CLASSES_DOCUMENTS: Joi.string().uri().optional(),
  R2_KEY_PREFIX_CLASSES_DOCUMENTS: Joi.string().allow('').optional(),

  R2_BUCKET_EVIDENCE_FILES: Joi.string().required(),
  R2_PUBLIC_URL_EVIDENCE_FILES: Joi.string().uri().required(),
  R2_KEY_PREFIX_EVIDENCE_FILES: Joi.string().allow('').optional(),
  R2_KEY_PREFIX_CLASS_EVIDENCE: Joi.string().allow('').optional(),

  R2_BUCKET_INSURANCE_EVIDENCE: Joi.string().required(),
  R2_PUBLIC_URL_INSURANCE_EVIDENCE: Joi.string().uri().required(),
  R2_KEY_PREFIX_INSURANCE_EVIDENCE: Joi.string().allow('').optional(),

  // Cloudflare R2 — GDPR data exports bucket (private, presigned URLs only)
  R2_BUCKET_DATA_EXPORTS: Joi.string().required(),
  R2_PUBLIC_URL_DATA_EXPORTS: Joi.string().uri().required(),
  R2_KEY_PREFIX_DATA_EXPORTS: Joi.string().allow('').optional(),

  // Cloudflare R2 — resources bucket (private, presigned PUT for uploads,
  // signed GET for downloads). Usually mapped to the shared "secure-documents"
  // bucket with key prefix "resources" to mirror the rest of the private modules.
  R2_BUCKET_RESOURCES_FILES: Joi.string().required(),
  R2_PUBLIC_URL_RESOURCES_FILES: Joi.string().uri().required(),
  R2_KEY_PREFIX_RESOURCES_FILES: Joi.string().allow('').optional(),

  // Cloudflare R2 — camporee payment vouchers bucket (private, presigned URLs)
  R2_BUCKET_CAMPOREE_PAYMENT_VOUCHERS: Joi.string().optional(),
  R2_PUBLIC_URL_CAMPOREE_PAYMENT_VOUCHERS: Joi.string().uri().optional(),
  R2_KEY_PREFIX_CAMPOREE_PAYMENT_VOUCHERS: Joi.string().allow('').optional(),

  // Firebase
  FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: Joi.string().allow('').optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: Joi.string().allow('').optional(),
  FIREBASE_PROJECT_ID: Joi.string().allow('').optional(),
  FIREBASE_PRIVATE_KEY: Joi.string().allow('').optional(),
  FIREBASE_CLIENT_EMAIL: Joi.string().email().allow('').optional(),

  // OAuth providers
  GOOGLE_CLIENT_ID: Joi.string().allow('').optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').optional(),
  APPLE_CLIENT_ID: Joi.string().allow('').optional(),
  APPLE_TEAM_ID: Joi.string().allow('').optional(),
  APPLE_KEY_ID: Joi.string().allow('').optional(),
  APPLE_PRIVATE_KEY: Joi.string().allow('').optional(),
  // Comma-separated allowlist of valid OAuth redirectUrl values.
  // Falls back to ALLOWED_ORIGINS when not set.
  ALLOWED_OAUTH_REDIRECT_URLS: Joi.string().optional(),

  // Sentry
  SENTRY_DSN: Joi.string().uri().allow('').optional(),

  // Bootstrap admin (one-time setup secret)
  // If not set, POST /api/v1/admin/rbac/bootstrap-admin returns 403 (disabled).
  BOOTSTRAP_SECRET: Joi.string().trim().min(32).optional(),
});
