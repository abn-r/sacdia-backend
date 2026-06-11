CREATE TYPE "honor_completion_mode_enum" AS ENUM ('UNDECIDED', 'IN_APP', 'EXTERNAL');

ALTER TABLE "users_honors"
  ADD COLUMN "completion_mode" "honor_completion_mode_enum" NOT NULL DEFAULT 'UNDECIDED';
