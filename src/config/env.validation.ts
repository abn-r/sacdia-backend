import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // Database (required)
  DATABASE_URL: Joi.string().uri().required(),
  DATABASE_DIRECT_URL: Joi.string().uri().optional(),

  // Better Auth (required)
  BETTER_AUTH_SECRET: Joi.string().min(32).required(),
  BETTER_AUTH_BASE_URL: Joi.string().uri().optional(),

  // App
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  FRONTEND_URL: Joi.string().uri().optional(),
  ALLOWED_ORIGINS: Joi.string().optional(),
  AUTH_REJECT_SNAKE_CASE: Joi.boolean().default(false),

  // Logging
  LOG_LEVEL: Joi.string()
    .valid('debug', 'info', 'warn', 'error')
    .optional(),
  LOG_PRETTY: Joi.boolean().optional(),
  LOG_PRETTY_IGNORE: Joi.string().optional(),

  // Redis
  REDIS_URL: Joi.string().optional(),

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

  R2_BUCKET_HONORS_PDF: Joi.string().optional(),
  R2_PUBLIC_URL_HONORS_PDF: Joi.string().uri().optional(),
  R2_KEY_PREFIX_HONORS_PDF: Joi.string().allow('').optional(),

  R2_BUCKET_CLASSES_DOCUMENTS: Joi.string().optional(),
  R2_PUBLIC_URL_CLASSES_DOCUMENTS: Joi.string().uri().optional(),
  R2_KEY_PREFIX_CLASSES_DOCUMENTS: Joi.string().allow('').optional(),

  R2_BUCKET_EVIDENCE_FILES: Joi.string().optional(),
  R2_PUBLIC_URL_EVIDENCE_FILES: Joi.string().uri().optional(),
  R2_KEY_PREFIX_EVIDENCE_FILES: Joi.string().allow('').optional(),
  R2_KEY_PREFIX_CLASS_EVIDENCE: Joi.string().allow('').optional(),

  R2_BUCKET_INSURANCE_EVIDENCE: Joi.string().optional(),
  R2_PUBLIC_URL_INSURANCE_EVIDENCE: Joi.string().uri().optional(),
  R2_KEY_PREFIX_INSURANCE_EVIDENCE: Joi.string().allow('').optional(),

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

  // Sentry
  SENTRY_DSN: Joi.string().uri().allow('').optional(),
});
