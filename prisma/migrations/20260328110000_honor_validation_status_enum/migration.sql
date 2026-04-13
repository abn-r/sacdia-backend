-- CreateEnum
CREATE TYPE "honor_validation_status_enum" AS ENUM ('IN_PROGRESS', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- Normalize existing VARCHAR values to uppercase enum strings.
-- Also handles the 'validated' mismatch from old evidence-review code (maps to APPROVED).
-- 'pending' was used in analytics.service.ts by mistake — maps to IN_PROGRESS for safety.
UPDATE users_honors SET validation_status = 'IN_PROGRESS'    WHERE validation_status = 'in_progress';
UPDATE users_honors SET validation_status = 'PENDING_REVIEW' WHERE validation_status = 'pending_review';
UPDATE users_honors SET validation_status = 'APPROVED'       WHERE validation_status = 'approved';
UPDATE users_honors SET validation_status = 'REJECTED'       WHERE validation_status = 'rejected';
UPDATE users_honors SET validation_status = 'APPROVED'       WHERE validation_status = 'validated';
UPDATE users_honors SET validation_status = 'IN_PROGRESS'    WHERE validation_status = 'pending';

-- Drop default before altering the column type
ALTER TABLE users_honors ALTER COLUMN validation_status DROP DEFAULT;

-- Change column type from VARCHAR(20) to the new enum
ALTER TABLE users_honors
  ALTER COLUMN validation_status TYPE "honor_validation_status_enum"
  USING validation_status::"honor_validation_status_enum";

-- Re-add default using enum value
ALTER TABLE users_honors
  ALTER COLUMN validation_status SET DEFAULT 'IN_PROGRESS'::"honor_validation_status_enum";
