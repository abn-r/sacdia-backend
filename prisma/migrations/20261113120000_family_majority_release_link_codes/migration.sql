-- Phase 4 (release at majority): adult_claim link codes. A former guardian or a
-- club director issues one so a released, account-less adult can claim their
-- own account (credential + email created in one transaction).
-- Row shape: dependent_user_id = the adult; issued_by_user_id = former guardian
-- or director; consumed_by_user_id = dependent_user_id when redeemed.
-- No nullability change. Re-runnable; no DML.

ALTER TABLE guardianship_link_codes DROP CONSTRAINT IF EXISTS guardianship_link_codes_purpose_ck;
ALTER TABLE guardianship_link_codes ADD CONSTRAINT guardianship_link_codes_purpose_ck
  CHECK (purpose IN ('second_guardian', 'director_claim', 'teen_guardian_link', 'adult_claim'));

ALTER TABLE guardianship_link_codes DROP CONSTRAINT IF EXISTS guardianship_link_codes_adult_claim_ck;
ALTER TABLE guardianship_link_codes ADD CONSTRAINT guardianship_link_codes_adult_claim_ck
  CHECK (purpose <> 'adult_claim' OR consumed_by_user_id IS NULL OR consumed_by_user_id = dependent_user_id);
