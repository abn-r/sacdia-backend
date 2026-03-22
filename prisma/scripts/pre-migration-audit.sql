-- =============================================================
-- PRE-MIGRATION AUDIT: Club Sections Consolidation
-- Run this BEFORE applying the migration.
-- Expected: zero anomalies, non-zero row counts.
-- =============================================================

-- 1. Row counts per source table (baseline for post-migration check)
SELECT 'club_adventurers' AS source_table, COUNT(*) AS row_count FROM club_adventurers
UNION ALL
SELECT 'club_pathfinders', COUNT(*) FROM club_pathfinders
UNION ALL
SELECT 'club_master_guilds', COUNT(*) FROM club_master_guilds;

-- 2. Verify club_type_id values are consistent
SELECT 'club_adventurers' AS source, ct.name AS club_type_name, ca.club_type_id, COUNT(*) AS cnt
FROM club_adventurers ca JOIN club_types ct ON ca.club_type_id = ct.club_type_id
GROUP BY ct.name, ca.club_type_id
UNION ALL
SELECT 'club_pathfinders', ct.name, cp.club_type_id, COUNT(*)
FROM club_pathfinders cp JOIN club_types ct ON cp.club_type_id = ct.club_type_id
GROUP BY ct.name, cp.club_type_id
UNION ALL
SELECT 'club_master_guilds', ct.name, cm.club_type_id, COUNT(*)
FROM club_master_guilds cm JOIN club_types ct ON cm.club_type_id = ct.club_type_id
GROUP BY ct.name, cm.club_type_id;

-- 3. NULL main_club_id counts (these will stay NULL in club_sections)
SELECT 'club_adventurers' AS source, COUNT(*) FILTER (WHERE main_club_id IS NULL) AS null_main_club
FROM club_adventurers
UNION ALL
SELECT 'club_pathfinders', COUNT(*) FILTER (WHERE main_club_id IS NULL) FROM club_pathfinders
UNION ALL
SELECT 'club_master_guilds', COUNT(*) FILTER (WHERE main_club_id IS NULL) FROM club_master_guilds;

-- 4. Dependent table FK usage (how many non-NULL FKs per column per table)
SELECT 'activities' AS dep_table,
  COUNT(*) FILTER (WHERE club_adv_id IS NOT NULL) AS adv_refs,
  COUNT(*) FILTER (WHERE club_pathf_id IS NOT NULL) AS pathf_refs,
  COUNT(*) FILTER (WHERE club_mg_id IS NOT NULL) AS mg_refs
FROM activities
UNION ALL
SELECT 'activity_instances',
  COUNT(*) FILTER (WHERE club_adv_id IS NOT NULL),
  COUNT(*) FILTER (WHERE club_pathf_id IS NOT NULL),
  COUNT(*) FILTER (WHERE club_mg_id IS NOT NULL)
FROM activity_instances
UNION ALL
SELECT 'folder_assignments',
  COUNT(*) FILTER (WHERE club_adv_id IS NOT NULL),
  COUNT(*) FILTER (WHERE club_pathf_id IS NOT NULL),
  COUNT(*) FILTER (WHERE club_mg_id IS NOT NULL)
FROM folder_assignments
UNION ALL
SELECT 'camporee_clubs',
  COUNT(*) FILTER (WHERE club_adv_id IS NOT NULL),
  COUNT(*) FILTER (WHERE club_pathf_id IS NOT NULL),
  COUNT(*) FILTER (WHERE club_mg_id IS NOT NULL)
FROM camporee_clubs
UNION ALL
SELECT 'club_inventory',
  COUNT(*) FILTER (WHERE club_adv_id IS NOT NULL),
  COUNT(*) FILTER (WHERE club_pathf_id IS NOT NULL),
  COUNT(*) FILTER (WHERE club_mg_id IS NOT NULL)
FROM club_inventory
UNION ALL
SELECT 'club_role_assignments',
  COUNT(*) FILTER (WHERE club_adv_id IS NOT NULL),
  COUNT(*) FILTER (WHERE club_pathf_id IS NOT NULL),
  COUNT(*) FILTER (WHERE club_mg_id IS NOT NULL)
FROM club_role_assignments
UNION ALL
SELECT 'finances',
  COUNT(*) FILTER (WHERE club_adv_id IS NOT NULL),
  COUNT(*) FILTER (WHERE club_pathf_id IS NOT NULL),
  COUNT(*) FILTER (WHERE club_mg_id IS NOT NULL)
FROM finances
UNION ALL
SELECT 'folders_modules_records',
  COUNT(*) FILTER (WHERE club_adv_id IS NOT NULL),
  COUNT(*) FILTER (WHERE club_pathf_id IS NOT NULL),
  COUNT(*) FILTER (WHERE club_mg_id IS NOT NULL)
FROM folders_modules_records
UNION ALL
SELECT 'folders_section_records',
  COUNT(*) FILTER (WHERE club_adv_id IS NOT NULL),
  COUNT(*) FILTER (WHERE club_pathf_id IS NOT NULL),
  COUNT(*) FILTER (WHERE club_mg_id IS NOT NULL)
FROM folders_section_records
UNION ALL
SELECT 'units',
  COUNT(*) FILTER (WHERE club_adv_id IS NOT NULL),
  COUNT(*) FILTER (WHERE club_pathf_id IS NOT NULL),
  COUNT(*) FILTER (WHERE club_mg_id IS NOT NULL)
FROM units;

-- 5. Anomaly: rows with MORE THAN ONE FK set (should be 0 for most tables)
SELECT 'activities' AS dep_table, COUNT(*) AS multi_fk_rows
FROM activities
WHERE (CASE WHEN club_adv_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN club_pathf_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN club_mg_id IS NOT NULL THEN 1 ELSE 0 END) > 1
UNION ALL
SELECT 'activity_instances', COUNT(*) FROM activity_instances
WHERE (CASE WHEN club_adv_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN club_pathf_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN club_mg_id IS NOT NULL THEN 1 ELSE 0 END) > 1
UNION ALL
SELECT 'club_role_assignments', COUNT(*) FROM club_role_assignments
WHERE (CASE WHEN club_adv_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN club_pathf_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN club_mg_id IS NOT NULL THEN 1 ELSE 0 END) > 1
UNION ALL
SELECT 'camporee_clubs', COUNT(*) FROM camporee_clubs
WHERE (CASE WHEN club_adv_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN club_pathf_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN club_mg_id IS NOT NULL THEN 1 ELSE 0 END) > 1
UNION ALL
SELECT 'club_inventory', COUNT(*) FROM club_inventory
WHERE (CASE WHEN club_adv_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN club_pathf_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN club_mg_id IS NOT NULL THEN 1 ELSE 0 END) > 1
UNION ALL
SELECT 'finances', COUNT(*) FROM finances
WHERE (CASE WHEN club_adv_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN club_pathf_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN club_mg_id IS NOT NULL THEN 1 ELSE 0 END) > 1
UNION ALL
SELECT 'folders_modules_records', COUNT(*) FROM folders_modules_records
WHERE (CASE WHEN club_adv_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN club_pathf_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN club_mg_id IS NOT NULL THEN 1 ELSE 0 END) > 1
UNION ALL
SELECT 'folders_section_records', COUNT(*) FROM folders_section_records
WHERE (CASE WHEN club_adv_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN club_pathf_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN club_mg_id IS NOT NULL THEN 1 ELSE 0 END) > 1
UNION ALL
SELECT 'units', COUNT(*) FROM units
WHERE (CASE WHEN club_adv_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN club_pathf_id IS NOT NULL THEN 1 ELSE 0 END
     + CASE WHEN club_mg_id IS NOT NULL THEN 1 ELSE 0 END) > 1;

-- 6. Orphan check: FKs pointing to non-existent source rows
SELECT 'activities->club_adventurers' AS check_name, COUNT(*) AS orphans
FROM activities a WHERE a.club_adv_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM club_adventurers ca WHERE ca.club_adv_id = a.club_adv_id)
UNION ALL
SELECT 'activities->club_pathfinders', COUNT(*)
FROM activities a WHERE a.club_pathf_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM club_pathfinders cp WHERE cp.club_pathf_id = a.club_pathf_id)
UNION ALL
SELECT 'activities->club_master_guilds', COUNT(*)
FROM activities a WHERE a.club_mg_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM club_master_guilds cm WHERE cm.club_mg_id = a.club_mg_id);

-- 7. folder_assignments orphan FK check (no @relation in Prisma — may be dead columns)
SELECT 'folder_assignments->club_adventurers (ORPHAN FK)' AS check_name, COUNT(*) AS refs
FROM folder_assignments WHERE club_adv_id IS NOT NULL
UNION ALL
SELECT 'folder_assignments->club_pathfinders (ORPHAN FK)', COUNT(*)
FROM folder_assignments WHERE club_pathf_id IS NOT NULL
UNION ALL
SELECT 'folder_assignments->club_master_guilds (ORPHAN FK)', COUNT(*)
FROM folder_assignments WHERE club_mg_id IS NOT NULL;

-- 8. Duplicate unique constraints on club_role_assignments (confirm both exist)
SELECT conname, contype, conrelid::regclass
FROM pg_constraint
WHERE conrelid = 'club_role_assignments'::regclass
  AND conname IN ('club_role_assignment_unique', 'club_role_assignment_unique_refactored');

-- 9. Permission strings that will need updating
SELECT permission_id, permission_name
FROM permissions
WHERE permission_name LIKE 'club_instances%';

-- 10. Current index listing for the 3 source tables (to know what gets dropped)
SELECT tablename, indexname
FROM pg_indexes
WHERE tablename IN ('club_adventurers', 'club_pathfinders', 'club_master_guilds')
ORDER BY tablename, indexname;
