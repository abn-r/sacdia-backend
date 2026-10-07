-- =============================================================
-- AUDIT (READ-ONLY): club role / Guia Mayor eligibility violations
-- Change: club-role-guide-major-eligibility (PR6)
--
-- Usage:  psql "$DATABASE_URL" -f club-role-gm-audit.sql
-- Wrapped in BEGIN READ ONLY ... ROLLBACK: it cannot write.
--
-- Categories (one row per assignment per category):
--   RULE_3_GM_MEMBER_IN_AV_CQ  GM-eligible person holding active `member` in an
--                              AV/CQ section. Candidates for AUTO-END (cleanup).
--   RULE_1_MANUAL_REVIEW       Active non-`member` role held by a person WITHOUT
--                              GM eligibility. MANUAL REVIEW ONLY, never auto-ended.
--   UNKNOWN_SECTION_KIND       Active assignment in a section whose club type name
--                              does not resolve to AV/CQ/GM. Informational.
--
-- GM eligibility mirrors src/club-role-eligibility/club-role-eligibility.service.ts:
--   class asset_code = 'GM-01' AND (
--     investiture_status IN (INVESTIDO, APPROVED)  -- any year
--     OR (enrollment.active AND class.active AND investiture_status IN
--         (IN_PROGRESS, SUBMITTED_FOR_VALIDATION, CLUB_APPROVED,
--          COORDINATOR_APPROVED, FIELD_APPROVED)))
-- Basis priority: INVESTED > APPROVED > ACTIVE_ENROLLMENT (ties: newest enrollment).
-- Section kind mirrors src/clubs/section-display.ts (clubTypeCycleRank):
--   normalized name (lowercase, no accents, [_-] -> space) contains
--   'guia' | 'master guide' | 'master guild' -> GM;
--   'conquistador' | 'pathfinder' -> CQ; 'aventurer' | 'adventurer' -> AV; else UNKNOWN.
-- "Active assignment" = active = true AND status IN ('active','designated').
-- =============================================================

\set ON_ERROR_STOP on
\pset pager off

BEGIN READ ONLY;

\echo '=== 1. Detail rows (all categories) ==='

WITH section_kinds AS (
  SELECT cs.club_section_id,
         cs.main_club_id,
         cs.active AS section_active,
         ct.name AS club_type_name,
         CASE
           WHEN n.v LIKE '%guia%' OR n.v LIKE '%master guide%' OR n.v LIKE '%master guild%' THEN 'GM'
           WHEN n.v LIKE '%conquistador%' OR n.v LIKE '%pathfinder%' THEN 'CQ'
           WHEN n.v LIKE '%aventurer%' OR n.v LIKE '%adventurer%' THEN 'AV'
           ELSE 'UNKNOWN'
         END AS section_kind
  FROM club_sections cs
  JOIN club_types ct ON ct.club_type_id = cs.club_type_id
  CROSS JOIN LATERAL (
    SELECT btrim(regexp_replace(regexp_replace(
             translate(lower(ct.name), 'áéíóúüñàèìòùâêîôû', 'aeiouunaeiouaeiou'),
             '[_-]+', ' ', 'g'), '\s+', ' ', 'g')) AS v
  ) n
),
gm_eligible AS (
  SELECT DISTINCT ON (e.user_id)
         e.user_id,
         b.basis,
         e.enrollment_id
  FROM enrollments e
  JOIN classes c ON c.class_id = e.class_id
  CROSS JOIN LATERAL (
    SELECT CASE e.investiture_status::text
             WHEN 'INVESTIDO' THEN 'INVESTED'
             WHEN 'APPROVED' THEN 'APPROVED'
             ELSE 'ACTIVE_ENROLLMENT'
           END AS basis,
           CASE e.investiture_status::text
             WHEN 'INVESTIDO' THEN 0
             WHEN 'APPROVED' THEN 1
             ELSE 2
           END AS prio
  ) b
  WHERE c.asset_code = 'GM-01'
    AND (
      e.investiture_status::text IN ('INVESTIDO', 'APPROVED')
      OR (
        e.active
        AND c.active
        AND e.investiture_status::text IN (
          'IN_PROGRESS', 'SUBMITTED_FOR_VALIDATION', 'CLUB_APPROVED',
          'COORDINATOR_APPROVED', 'FIELD_APPROVED'
        )
      )
    )
  ORDER BY e.user_id, b.prio, e.enrollment_date DESC
),
active_assignments AS (
  SELECT a.*, r.role_name
  FROM club_role_assignments a
  JOIN roles r ON r.role_id = a.role_id
  WHERE a.active = true
    AND COALESCE(a.status, 'active') IN ('active', 'designated')
),
classified AS (
  SELECT a.*, sk.section_kind, sk.club_type_name, sk.main_club_id,
         g.basis AS gm_basis, g.enrollment_id AS gm_enrollment_id,
         (g.user_id IS NOT NULL) AS gm_eligible
  FROM active_assignments a
  LEFT JOIN section_kinds sk ON sk.club_section_id = a.club_section_id
  LEFT JOIN gm_eligible g ON g.user_id = a.user_id
),
rows_by_category AS (
  SELECT 'RULE_3_GM_MEMBER_IN_AV_CQ' AS cat, c.* FROM classified c
   WHERE c.role_name = 'member' AND c.gm_eligible AND c.section_kind IN ('AV', 'CQ')
  UNION ALL
  SELECT 'RULE_1_MANUAL_REVIEW', c.* FROM classified c
   WHERE c.role_name <> 'member' AND NOT c.gm_eligible
  UNION ALL
  SELECT 'UNKNOWN_SECTION_KIND', c.* FROM classified c
   WHERE c.section_kind = 'UNKNOWN'
)
SELECT rc.cat AS category,
       count(*) OVER (PARTITION BY rc.cat) AS category_count,
       rc.assignment_id,
       rc.user_id,
       u.email AS user_email,
       btrim(concat_ws(' ', u.name, u.paternal_last_name, u.maternal_last_name)) AS user_name,
       cl.club_id,
       cl.name AS club_name,
       rc.club_section_id,
       rc.club_type_name AS section,
       rc.section_kind,
       rc.role_name,
       rc.status,
       rc.active,
       rc.start_date,
       rc.end_date,
       rc.ecclesiastical_year_id,
       rc.gm_basis,
       rc.gm_enrollment_id,
       (SELECT count(*) FROM section_kinds g2
         WHERE g2.main_club_id = rc.main_club_id AND g2.section_active
           AND g2.section_kind = 'GM'
       ) AS club_active_gm_sections
FROM rows_by_category rc
LEFT JOIN users u ON u.user_id = rc.user_id
LEFT JOIN clubs cl ON cl.club_id = rc.main_club_id
ORDER BY rc.cat, cl.name, u.email, rc.assignment_id;

\echo '=== 2. Counts per category ==='

WITH section_kinds AS (
  SELECT cs.club_section_id,
         CASE
           WHEN n.v LIKE '%guia%' OR n.v LIKE '%master guide%' OR n.v LIKE '%master guild%' THEN 'GM'
           WHEN n.v LIKE '%conquistador%' OR n.v LIKE '%pathfinder%' THEN 'CQ'
           WHEN n.v LIKE '%aventurer%' OR n.v LIKE '%adventurer%' THEN 'AV'
           ELSE 'UNKNOWN'
         END AS section_kind
  FROM club_sections cs
  JOIN club_types ct ON ct.club_type_id = cs.club_type_id
  CROSS JOIN LATERAL (
    SELECT btrim(regexp_replace(regexp_replace(
             translate(lower(ct.name), 'áéíóúüñàèìòùâêîôû', 'aeiouunaeiouaeiou'),
             '[_-]+', ' ', 'g'), '\s+', ' ', 'g')) AS v
  ) n
),
gm_eligible AS (
  SELECT DISTINCT e.user_id
  FROM enrollments e
  JOIN classes c ON c.class_id = e.class_id
  WHERE c.asset_code = 'GM-01'
    AND (
      e.investiture_status::text IN ('INVESTIDO', 'APPROVED')
      OR (
        e.active
        AND c.active
        AND e.investiture_status::text IN (
          'IN_PROGRESS', 'SUBMITTED_FOR_VALIDATION', 'CLUB_APPROVED',
          'COORDINATOR_APPROVED', 'FIELD_APPROVED'
        )
      )
    )
),
classified AS (
  SELECT a.assignment_id, r.role_name, sk.section_kind,
         (g.user_id IS NOT NULL) AS gm_eligible
  FROM club_role_assignments a
  JOIN roles r ON r.role_id = a.role_id
  LEFT JOIN section_kinds sk ON sk.club_section_id = a.club_section_id
  LEFT JOIN gm_eligible g ON g.user_id = a.user_id
  WHERE a.active = true
    AND COALESCE(a.status, 'active') IN ('active', 'designated')
)
SELECT cat.category,
       count(c.assignment_id) AS assignments
FROM (VALUES ('RULE_3_GM_MEMBER_IN_AV_CQ'), ('RULE_1_MANUAL_REVIEW'), ('UNKNOWN_SECTION_KIND')) cat(category)
LEFT JOIN classified c ON
  (cat.category = 'RULE_3_GM_MEMBER_IN_AV_CQ'
     AND c.role_name = 'member' AND c.gm_eligible AND c.section_kind IN ('AV', 'CQ'))
  OR (cat.category = 'RULE_1_MANUAL_REVIEW'
     AND c.role_name <> 'member' AND NOT c.gm_eligible)
  OR (cat.category = 'UNKNOWN_SECTION_KIND' AND c.section_kind = 'UNKNOWN')
GROUP BY cat.category
ORDER BY cat.category;

ROLLBACK;
