/* Read-only P0 preflight: $1 canonical geographic IANA names; $2 sample limit;
$3 captured now. Timeouts precede this statement; output is bounded JSON. */
WITH
input AS MATERIALIZED (SELECT greatest(1, least(coalesce($2::int, 50), 100)) sample_limit),
runtime_timezones AS MATERIALIZED (SELECT name FROM pg_catalog.pg_timezone_names),
capabilities AS (
  SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'local_fields'
      AND column_name = 'timezone') THEN 'ready' ELSE 'schema_not_ready'
    END AS local_fields_timezone,
    ARRAY(SELECT required FROM unnest(ARRAY['club_section_id', 'status']) required
      WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'director_succession_plans'
          AND column_name = required) ORDER BY required) AS plan_missing_columns
),
assignment_scope AS NOT MATERIALIZED (
  SELECT a.assignment_id, a.user_id, a.role_id, a.ecclesiastical_year_id,
    a.start_date, a.end_date, a.active, a.status, a.expires_at,
    a.club_section_id, s.main_club_id, c.local_field_id,
    to_jsonb(lf)->>'timezone' AS timezone,
    host.name IS NOT NULL AS timezone_supported
  FROM club_role_assignments a
  LEFT JOIN club_sections s USING (club_section_id) LEFT JOIN clubs c ON c.club_id = s.main_club_id
  LEFT JOIN local_fields lf USING (local_field_id)
  LEFT JOIN runtime_timezones host
    ON host.name = to_jsonb(lf)->>'timezone'
),
assignments AS MATERIALIZED (
  SELECT assignment_id, user_id, role_id, ecclesiastical_year_id,
    start_date, end_date, active, status, expires_at, club_section_id,
    main_club_id, local_field_id, timezone, timezone_supported,
    timezone = ANY($1::text[]) AND timezone_supported AS timezone_valid,
    CASE WHEN timezone = ANY($1::text[]) AND timezone_supported
      THEN ($3::timestamptz AT TIME ZONE timezone)::date END AS business_date
  FROM assignment_scope a
),
invalid_intervals AS NOT MATERIALIZED (
  SELECT assignment_id, user_id, start_date, end_date
  FROM assignments WHERE end_date IS NOT NULL AND start_date > end_date
),
unknown_statuses AS NOT MATERIALIZED (
  SELECT assignment_id, user_id, status FROM assignments
  WHERE status IS NULL OR status <> ALL(
    ARRAY['active', 'pending', 'rejected', 'cancelled', 'ended', 'expired'])
),
ineffective AS NOT MATERIALIZED (
  SELECT assignment_id, user_id, club_section_id, timezone,
    timezone_supported,
    CASE
      WHEN status IS DISTINCT FROM 'active' THEN 'status_not_active'
      WHEN main_club_id IS NULL OR local_field_id IS NULL THEN 'resource_scope_unavailable'
      WHEN timezone_valid IS NOT TRUE THEN 'timezone_unavailable'
      WHEN start_date > business_date THEN 'future_start'
      WHEN end_date IS NOT NULL AND end_date < business_date THEN 'past_end'
      WHEN expires_at IS NOT NULL AND expires_at <= $3 THEN 'expired_at_instant'
    END AS reason
  FROM assignments
  WHERE active IS TRUE AND (
    status = 'active' AND main_club_id IS NOT NULL AND local_field_id IS NOT NULL
    AND timezone_valid IS TRUE AND start_date <= business_date AND (end_date IS NULL OR end_date >= business_date)
    AND (expires_at IS NULL OR expires_at > $3)
  ) IS NOT TRUE
),
director_intervals AS NOT MATERIALIZED (
  SELECT a.club_section_id, a.assignment_id, a.start_date, a.end_date,
    max(coalesce(a.end_date, 'infinity'::date)) OVER (
      PARTITION BY a.club_section_id, a.role_id ORDER BY a.start_date, a.assignment_id
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS previous_max_end
  FROM assignments a JOIN roles r USING (role_id)
  WHERE a.active IS TRUE AND a.status = 'active' AND a.club_section_id IS NOT NULL
    AND r.role_category::text = 'CLUB' AND lower(r.role_name) = 'director'
),
overlap_issues AS NOT MATERIALIZED (SELECT * FROM director_intervals WHERE previous_max_end >= start_date),
outside_year AS NOT MATERIALIZED (
  SELECT a.assignment_id, a.ecclesiastical_year_id, a.start_date, a.end_date,
    y.start_date AS year_start_date, y.end_date AS year_end_date
  FROM assignments a JOIN ecclesiastical_years y ON y.year_id = a.ecclesiastical_year_id
  WHERE a.start_date NOT BETWEEN y.start_date AND y.end_date
    OR (a.end_date IS NOT NULL AND a.end_date NOT BETWEEN y.start_date AND y.end_date)
),
stale_preferred AS NOT MATERIALIZED (
  SELECT p.user_id AS preferred_user_id, p.active_club_assignment_id,
    a.user_id AS assignment_user_id, a.timezone, a.timezone_supported,
    CASE WHEN a.assignment_id IS NULL THEN 'assignment_not_found'
      WHEN p.user_id IS DISTINCT FROM a.user_id THEN 'preferred_assignment_user_mismatch'
      WHEN a.active IS NOT TRUE THEN 'assignment_inactive'
      ELSE coalesce(i.reason, 'assignment_not_effective') END AS reason
  FROM users_pr p LEFT JOIN assignments a ON a.assignment_id = p.active_club_assignment_id
  LEFT JOIN ineffective i ON i.assignment_id = a.assignment_id
  WHERE p.active_club_assignment_id IS NOT NULL
    AND (a.assignment_id IS NULL OR p.user_id IS DISTINCT FROM a.user_id
      OR a.active IS NOT TRUE OR i.assignment_id IS NOT NULL)
),
asset_issue_counts AS NOT MATERIALIZED (
  SELECT 'duplicate_asset_code'::text issue, asset_code, count(*)::int occurrence_count
  FROM classes WHERE asset_code IS NOT NULL GROUP BY asset_code HAVING count(*) > 1
  UNION ALL
  SELECT 'gm_01_cardinality', 'GM-01', count(*)::int
  FROM classes WHERE asset_code = 'GM-01' HAVING count(*) <> 1
),
asset_issues AS NOT MATERIALIZED (
  SELECT a.*,
    ARRAY(SELECT c.class_id FROM classes c WHERE c.asset_code = a.asset_code
      ORDER BY c.class_id LIMIT (SELECT sample_limit FROM input)) class_ids,
    occurrence_count > (SELECT sample_limit FROM input) class_ids_truncated
  FROM asset_issue_counts a
),
audit_issues AS NOT MATERIALIZED (
  SELECT audit_log_id::text audit_log_id, action, length(action)::int action_length
  FROM audit_logs WHERE length(action) > 64
),
field_impact AS NOT MATERIALIZED (
  SELECT local_field_id, count(*)::int assignments_count,
    count(DISTINCT user_id)::int users_count
  FROM assignments WHERE active IS TRUE AND status = 'active' AND local_field_id IS NOT NULL
  GROUP BY local_field_id
),
field_issues AS NOT MATERIALIZED (
  SELECT lf.local_field_id, lf.name, lf.union_id,
    to_jsonb(lf)->>'timezone' timezone, host.name IS NOT NULL timezone_supported,
    coalesce(i.assignments_count, 0) assignments_count,
    coalesce(i.users_count, 0) users_count
  FROM local_fields lf LEFT JOIN field_impact i USING (local_field_id)
  LEFT JOIN runtime_timezones host ON host.name = to_jsonb(lf)->>'timezone'
  WHERE lf.active IS TRUE AND (to_jsonb(lf)->>'timezone' = ANY($1::text[])
    AND host.name IS NOT NULL) IS NOT TRUE
),
checks AS (
  SELECT 1 ordinal, 'invalid_assignment_intervals' id,
    (SELECT count(*)::int FROM invalid_intervals) total_count,
    (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM (SELECT * FROM invalid_intervals ORDER BY assignment_id LIMIT (SELECT sample_limit FROM input)) x) rows
  UNION ALL SELECT 2, 'unknown_assignment_statuses', (SELECT count(*)::int FROM unknown_statuses),
    (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM (SELECT * FROM unknown_statuses ORDER BY assignment_id LIMIT (SELECT sample_limit FROM input)) x)
  UNION ALL SELECT 3, 'active_but_not_effective', (SELECT count(*)::int FROM ineffective),
    (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM (SELECT * FROM ineffective ORDER BY assignment_id LIMIT (SELECT sample_limit FROM input)) x)
  UNION ALL SELECT 4, 'overlapping_directors', (SELECT count(*)::int FROM overlap_issues),
    (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]')
      FROM (SELECT * FROM overlap_issues ORDER BY club_section_id, assignment_id
        LIMIT (SELECT sample_limit FROM input)) x)
  UNION ALL SELECT 5, 'outside_ecclesiastical_year', (SELECT count(*)::int FROM outside_year),
    (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM (SELECT * FROM outside_year ORDER BY assignment_id LIMIT (SELECT sample_limit FROM input)) x)
  UNION ALL SELECT 6, 'stale_active_club_assignment', (SELECT count(*)::int FROM stale_preferred),
    (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM (SELECT * FROM stale_preferred ORDER BY preferred_user_id LIMIT (SELECT sample_limit FROM input)) x)
  UNION ALL SELECT 7, 'class_asset_codes', (SELECT count(*)::int FROM asset_issues),
    (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM (SELECT * FROM asset_issues ORDER BY issue, asset_code LIMIT (SELECT sample_limit FROM input)) x)
  UNION ALL SELECT 8, 'audit_action_length', (SELECT count(*)::int FROM audit_issues),
    (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM (SELECT * FROM audit_issues ORDER BY audit_log_id LIMIT (SELECT sample_limit FROM input)) x)
  UNION ALL SELECT 9, 'local_field_timezones', (SELECT count(*)::int FROM field_issues),
    (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]') FROM (SELECT * FROM field_issues ORDER BY local_field_id LIMIT (SELECT sample_limit FROM input)) x)
)
SELECT jsonb_build_object(
  'schema', jsonb_build_object(
    'local_fields_timezone', c.local_fields_timezone,
    'director_succession_plans', CASE WHEN cardinality(c.plan_missing_columns) = 0
      THEN 'ready' ELSE 'schema_not_ready' END,
    'director_succession_plans_missing_columns', c.plan_missing_columns
  ),
  'checks', (SELECT jsonb_agg(
    (to_jsonb(checks) - 'ordinal') || jsonb_build_object(
      'sample_count', jsonb_array_length(rows),
      'truncated', total_count > jsonb_array_length(rows)
    ) ORDER BY ordinal
  ) FROM checks)
) report FROM capabilities c;
