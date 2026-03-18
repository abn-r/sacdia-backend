-- =============================================================
-- POST-MIGRATION VERIFICATION: Club Sections Consolidation
-- Run AFTER applying the migration.
-- All checks should pass (expected values in comments).
-- =============================================================

-- 1. Row count in club_sections matches sum of deprecated tables
SELECT 'club_sections_count' AS check_name,
  (SELECT COUNT(*) FROM club_sections) AS actual,
  (SELECT COUNT(*) FROM club_adventurers_deprecated)
  + (SELECT COUNT(*) FROM club_pathfinders_deprecated)
  + (SELECT COUNT(*) FROM club_master_guilds_deprecated) AS expected,
  CASE
    WHEN (SELECT COUNT(*) FROM club_sections) =
         (SELECT COUNT(*) FROM club_adventurers_deprecated)
         + (SELECT COUNT(*) FROM club_pathfinders_deprecated)
         + (SELECT COUNT(*) FROM club_master_guilds_deprecated)
    THEN 'PASS' ELSE 'FAIL'
  END AS result;

-- 2. No orphan club_section_id in any dependent table
SELECT 'activities_orphans' AS check_name,
  COUNT(*) AS orphan_count,
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result
FROM activities a
WHERE a.club_section_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM club_sections cs WHERE cs.club_section_id = a.club_section_id)
UNION ALL
SELECT 'activity_instances_orphans', COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM activity_instances ai
WHERE ai.club_section_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM club_sections cs WHERE cs.club_section_id = ai.club_section_id)
UNION ALL
SELECT 'club_role_assignments_orphans', COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM club_role_assignments cra
WHERE cra.club_section_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM club_sections cs WHERE cs.club_section_id = cra.club_section_id)
UNION ALL
SELECT 'units_orphans', COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM units u
WHERE u.club_section_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM club_sections cs WHERE cs.club_section_id = u.club_section_id)
UNION ALL
SELECT 'finances_orphans', COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM finances f
WHERE f.club_section_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM club_sections cs WHERE cs.club_section_id = f.club_section_id)
UNION ALL
SELECT 'camporee_clubs_orphans', COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM camporee_clubs cc
WHERE cc.club_section_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM club_sections cs WHERE cs.club_section_id = cc.club_section_id);

-- 3. Old columns are gone
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'activities' AND column_name IN ('club_adv_id', 'club_pathf_id', 'club_mg_id')
  ) THEN
    RAISE EXCEPTION 'OLD COLUMNS STILL EXIST in activities';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'club_role_assignments' AND column_name IN ('club_adv_id', 'club_pathf_id', 'club_mg_id')
  ) THEN
    RAISE EXCEPTION 'OLD COLUMNS STILL EXIST in club_role_assignments';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'units' AND column_name IN ('club_adv_id', 'club_pathf_id', 'club_mg_id')
  ) THEN
    RAISE EXCEPTION 'OLD COLUMNS STILL EXIST in units';
  END IF;

  RAISE NOTICE 'All old columns successfully dropped.';
END $$;

-- 4. New FK constraints exist
SELECT conname, conrelid::regclass AS table_name, 'PASS' AS result
FROM pg_constraint
WHERE contype = 'f'
  AND conname LIKE '%club_section_id_fkey'
ORDER BY table_name;
-- Expected: 10 rows (one per dependent table)

-- 5. New indexes exist
SELECT indexname, tablename, 'PASS' AS result
FROM pg_indexes
WHERE indexname LIKE '%club_section%'
ORDER BY tablename;
-- Expected: 10+ rows

-- 6. UNIQUE constraints are correct
SELECT conname, conrelid::regclass AS table_name
FROM pg_constraint
WHERE contype = 'u'
  AND conrelid IN ('club_role_assignments'::regclass, 'activity_instances'::regclass, 'club_sections'::regclass)
ORDER BY table_name, conname;
-- Expected:
--   activity_instances: activity_instances_unique_per_section
--   club_role_assignments: club_role_assignment_unique (NEW one with club_section_id)
--   club_sections: club_sections_main_club_id_club_type_id_key

-- 7. No duplicate unique constraints remain on club_role_assignments
SELECT conname FROM pg_constraint
WHERE conrelid = 'club_role_assignments'::regclass AND contype = 'u';
-- Expected: exactly 1 row (club_role_assignment_unique)

-- 8. Deprecated tables still exist (for rollback safety)
SELECT tablename, 'EXISTS' AS status
FROM pg_tables
WHERE tablename IN ('club_adventurers_deprecated', 'club_pathfinders_deprecated', 'club_master_guilds_deprecated');
-- Expected: 3 rows

-- 9. Permission strings updated
SELECT permission_name, 'FAIL — still has club_instances' AS result
FROM permissions WHERE permission_name LIKE 'club_instances%'
UNION ALL
SELECT permission_name, 'PASS' FROM permissions WHERE permission_name LIKE 'club_sections%';
-- Expected: only PASS rows, zero FAIL rows

-- 10. club_sections has correct club_type distribution
SELECT ct.name AS club_type, COUNT(*) AS section_count
FROM club_sections cs
JOIN club_types ct ON cs.club_type_id = ct.club_type_id
GROUP BY ct.name
ORDER BY ct.name;
-- Expected: matches pre-audit query 2
