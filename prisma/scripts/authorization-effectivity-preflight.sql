/*
 * READ-ONLY preflight: club role assignments that stop granting permissions
 * once temporal effectivity (start_date / end_date / expires_at) is enforced
 * in permission resolution, guards and setActiveClubContext.
 *
 * RUN ON NEON BEFORE DEPLOYING this change. The rows listed here are
 * active = true AND status = 'active' in the current ecclesiastical year but
 * are outside their validity window, so they WILL LOSE PERMISSIONS (and cannot
 * be selected as active club context) after the deploy. Fix the data or warn
 * the affected users first.
 *
 * No UPDATE / DELETE / DDL. Dates use CURRENT_DATE (session time zone, UTC on
 * Neon); the application evaluates each row at the business date of its Local
 * Field, so rows on the exact boundary day may differ by one day.
 */
SELECT
  a.assignment_id,
  a.user_id,
  u.email,
  a.club_section_id,
  r.role_name,
  lf.local_field_id,
  lf.name AS local_field,
  a.start_date,
  a.end_date,
  a.expires_at,
  concat_ws(
    ', ',
    CASE WHEN a.start_date > CURRENT_DATE THEN 'start_date in the future' END,
    CASE WHEN a.end_date < CURRENT_DATE THEN 'end_date already passed' END,
    CASE WHEN a.expires_at < NOW() THEN 'expires_at already passed' END
  ) AS failing_condition
FROM club_role_assignments a
JOIN ecclesiastical_years y ON y.year_id = a.ecclesiastical_year_id
LEFT JOIN users u ON u.user_id = a.user_id
LEFT JOIN roles r ON r.role_id = a.role_id
LEFT JOIN club_sections s ON s.club_section_id = a.club_section_id
LEFT JOIN clubs c ON c.club_id = s.main_club_id
LEFT JOIN local_fields lf ON lf.local_field_id = c.local_field_id
WHERE a.active = TRUE
  AND a.status = 'active'
  AND y.active = TRUE
  AND (
    a.start_date > CURRENT_DATE
    OR a.end_date < CURRENT_DATE
    OR a.expires_at < NOW()
  )
ORDER BY lf.name, r.role_name, u.email;
