-- Preserve the owning camporee-club enrollment for every registered member and
-- enforce one active registration per camporee and club section.

BEGIN;

ALTER TABLE "camporee_members"
  ADD COLUMN "camporee_club_id" INTEGER;

ALTER TABLE "camporee_members"
  ADD CONSTRAINT "fk_camporee_members_camporee_club"
  FOREIGN KEY ("camporee_club_id")
  REFERENCES "camporee_clubs"("camporee_club_id")
  ON DELETE NO ACTION
  ON UPDATE NO ACTION;

CREATE INDEX "idx_camporee_members_camporee_club_id"
  ON "camporee_members"("camporee_club_id");

-- Fail closed before adding the unique indexes. Existing registrations require
-- a business decision, so this migration never deactivates, deletes, or merges
-- duplicate rows automatically.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "camporee_clubs"
    WHERE "active" = TRUE
      AND "camporee_id" IS NOT NULL
      AND "club_section_id" IS NOT NULL
    GROUP BY "camporee_id", "club_section_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Cannot enforce active local camporee section uniqueness: duplicate active camporee_clubs rows exist for (camporee_id, club_section_id).',
      HINT = 'Remediation: review the duplicates and explicitly deactivate or correct the invalid registrations, then retry this migration. No rows were deleted or merged.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "camporee_clubs"
    WHERE "active" = TRUE
      AND "union_camporee_id" IS NOT NULL
      AND "club_section_id" IS NOT NULL
    GROUP BY "union_camporee_id", "club_section_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23505',
      MESSAGE = 'Cannot enforce active union camporee section uniqueness: duplicate active camporee_clubs rows exist for (union_camporee_id, club_section_id).',
      HINT = 'Remediation: review the duplicates and explicitly deactivate or correct the invalid registrations, then retry this migration. No rows were deleted or merged.';
  END IF;
END
$$;

CREATE UNIQUE INDEX "uq_camporee_clubs_active_local_section"
  ON "camporee_clubs"("camporee_id", "club_section_id")
  WHERE "active" = TRUE AND "camporee_id" IS NOT NULL;

CREATE UNIQUE INDEX "uq_camporee_clubs_active_union_section"
  ON "camporee_clubs"("union_camporee_id", "club_section_id")
  WHERE "active" = TRUE AND "union_camporee_id" IS NOT NULL;

INSERT INTO "permissions" ("permission_name", "description", "active")
VALUES (
  'camporees:register_active_section',
  'Register the director active club section in a camporee',
  TRUE
)
ON CONFLICT ("permission_name") DO UPDATE SET
  "description" = EXCLUDED."description",
  "active" = TRUE,
  "modified_at" = NOW();

-- Enforce least privilege even if a previous manual grant or a broad role seed
-- assigned the permission elsewhere.
DELETE FROM "role_permissions" rp
USING "permissions" p, "roles" r
WHERE rp."permission_id" = p."permission_id"
  AND rp."role_id" = r."role_id"
  AND p."permission_name" = 'camporees:register_active_section'
  AND NOT (
    r."role_name" = 'director'
    AND r."role_category" = 'CLUB'
  );

INSERT INTO "role_permissions" (
  "role_permission_id",
  "role_id",
  "permission_id",
  "active"
)
SELECT
  gen_random_uuid(),
  r."role_id",
  p."permission_id",
  TRUE
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r."role_name" = 'director'
  AND r."role_category" = 'CLUB'
  AND r."active" = TRUE
  AND p."permission_name" = 'camporees:register_active_section'
  AND p."active" = TRUE
ON CONFLICT ("role_id", "permission_id") DO UPDATE SET
  "active" = TRUE,
  "modified_at" = NOW();

COMMIT;
