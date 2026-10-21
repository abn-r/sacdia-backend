-- Allow guardianships.verification_method = 'coordinator_paper_form' (DDL only; precedent 20261020120000_family_teen_login, which widens CHECKs with drop + add).
-- A coordinator who verifies a minor's signed consent form (verify-consent through the coordinator
-- path, see 20261023120000_grant_consent_verify_to_coordinators) is recorded as 'coordinator_paper_form';
-- a club role (director, or a role with only consent:verify) keeps 'director_paper_form'.
-- 20261016120000_family_profiles created guardianships_verification_method_ck without that value, so
-- the UPDATE would fail with a CHECK violation until this runs. Apply it BEFORE deploying the backend.
-- Only the allowed-values list changes; existing rows already satisfy the wider list.
-- Re-runnable: DROP CONSTRAINT IF EXISTS + ADD. Apply by hand (shadow DB is broken, no migrate dev):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261024120000_allow_coordinator_paper_form/migration.sql
-- then: corepack pnpm exec prisma migrate resolve --applied 20261024120000_allow_coordinator_paper_form
-- Rollback: forward only once 'coordinator_paper_form' rows exist (re-adding the old CHECK would fail on them).
ALTER TABLE guardianships DROP CONSTRAINT IF EXISTS guardianships_verification_method_ck;
ALTER TABLE guardianships ADD CONSTRAINT guardianships_verification_method_ck
  CHECK (verification_method IS NULL OR verification_method IN ('director_paper_form', 'coordinator_paper_form', 'guardian_invite', 'legacy_import', 'test_placeholder'));
