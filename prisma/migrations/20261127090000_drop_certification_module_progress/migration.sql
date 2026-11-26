-- Drops certification_module_progress, the legacy per-module completion flag.
-- Its only writer was PATCH /certifications/users/:userId/certifications/
-- :certificationId/progress, removed in abn-r/sacdia-backend#687; it answered
-- 410 for every versioned enrollment and certification_version_id is NOT NULL.
-- Progress is computed from certification_section_progress (APPROVED required
-- sections of the enrollment's version). Nothing reads this table any more.
-- DESTRUCTIVE: the rows are lost. Render runs `prisma migrate deploy` at the
-- END OF THE BUILD. Re-runnable.

DROP TABLE IF EXISTS "certification_module_progress";
