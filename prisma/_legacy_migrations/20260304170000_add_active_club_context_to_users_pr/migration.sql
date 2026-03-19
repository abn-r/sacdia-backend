-- Add active club assignment pointer for user context switching
ALTER TABLE "users_pr"
ADD COLUMN "active_club_assignment_id" UUID;

-- Optional integrity can be enforced at application layer for now.
-- Future hardening can add FK with ON DELETE SET NULL once legacy data is normalized.
