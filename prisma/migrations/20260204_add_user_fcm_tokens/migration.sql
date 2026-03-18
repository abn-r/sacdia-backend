-- Add user_fcm_tokens table for Firebase Cloud Messaging support
CREATE TABLE IF NOT EXISTS "user_fcm_tokens" (
  "fcm_token_id" UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  "user_id" UUID NOT NULL,
  "token" VARCHAR(255) UNIQUE NOT NULL,
  "device_type" VARCHAR(50),
  "device_name" VARCHAR(100),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "last_used" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "modified_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT "fk_user_fcm_tokens_user_id" FOREIGN KEY ("user_id")
    REFERENCES "users" ("user_id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS "idx_user_fcm_tokens_user_id" ON "user_fcm_tokens" ("user_id");
CREATE INDEX IF NOT EXISTS "idx_user_fcm_tokens_active" ON "user_fcm_tokens" ("active");

COMMENT ON TABLE "user_fcm_tokens" IS 'Firebase Cloud Messaging tokens for push notifications';
COMMENT ON COLUMN "user_fcm_tokens"."token" IS 'FCM device registration token';
COMMENT ON COLUMN "user_fcm_tokens"."device_type" IS 'Platform: ios, android, web';
COMMENT ON COLUMN "user_fcm_tokens"."last_used" IS 'Last time this token was used to send a notification';
