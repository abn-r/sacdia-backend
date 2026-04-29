-- 20260429000002_enrollment_rankings_seeds
-- Audit A8 (permission_name + role_id UUID), A9 (system_config columns)

INSERT INTO enrollment_ranking_weights
  (club_type_id, ecclesiastical_year_id, class_pct, investiture_pct, camporee_pct, is_default)
VALUES
  (NULL, NULL, 50, 30, 20, true)
ON CONFLICT DO NOTHING;

INSERT INTO system_config (config_key, config_value, config_type, description) VALUES
  ('member_ranking.recalculation_enabled', 'true',      'boolean',
   'Kill-switch enrollment+section ranking recalc'),
  ('member_ranking.member_visibility',     'self_only', 'string',
   'self_only | self_and_top_n | hidden'),
  ('member_ranking.top_n',                 '5',         'integer',
   'How many top to show if visibility=self_and_top_n')
ON CONFLICT (config_key) DO NOTHING;

INSERT INTO permissions (permission_id, permission_name, description) VALUES
  (gen_random_uuid(), 'member_rankings:read_self',       'Read own member ranking'),
  (gen_random_uuid(), 'member_rankings:read_section',    'Read section member rankings'),
  (gen_random_uuid(), 'member_rankings:read_club',       'Read club member rankings'),
  (gen_random_uuid(), 'member_rankings:read_lf',         'Read local field member rankings'),
  (gen_random_uuid(), 'member_rankings:read_global',     'Read all member rankings'),
  (gen_random_uuid(), 'member_ranking_weights:read',     'Read member ranking weights'),
  (gen_random_uuid(), 'member_ranking_weights:write',    'Write/CRUD member ranking weights'),
  (gen_random_uuid(), 'section_rankings:read_club',      'Read club section rankings'),
  (gen_random_uuid(), 'section_rankings:read_lf',        'Read local field section rankings'),
  (gen_random_uuid(), 'section_rankings:read_global',    'Read all section rankings')
ON CONFLICT (permission_name) DO NOTHING;

-- Grants matriz §4.7
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM roles r, permissions p
  WHERE r.role_name = 'member' AND p.permission_name = 'member_rankings:read_self'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM roles r, permissions p
  WHERE r.role_name = 'assistant-club'
    AND p.permission_name IN ('member_rankings:read_section','member_rankings:read_club','section_rankings:read_club')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM roles r, permissions p
  WHERE r.role_name = 'director-club'
    AND p.permission_name IN ('member_rankings:read_section','member_rankings:read_club','section_rankings:read_club')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM roles r, permissions p
  WHERE r.role_name IN ('director-dia','assistant-dia')
    AND p.permission_name IN ('member_rankings:read_club','section_rankings:read_club')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM roles r, permissions p
  WHERE r.role_name IN ('director-lf','assistant-lf')
    AND p.permission_name IN ('member_rankings:read_lf','section_rankings:read_lf')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM roles r, permissions p
  WHERE r.role_name = 'director-lf'
    AND p.permission_name = 'member_ranking_weights:read'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM roles r, permissions p
  WHERE r.role_name IN ('director-union','assistant-union')
    AND p.permission_name IN ('member_rankings:read_global','section_rankings:read_global','member_ranking_weights:read')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id FROM roles r, permissions p
  WHERE r.role_name IN ('admin','super_admin')
    AND p.permission_name IN (
      'member_rankings:read_self','member_rankings:read_section','member_rankings:read_club',
      'member_rankings:read_lf','member_rankings:read_global',
      'member_ranking_weights:read','member_ranking_weights:write',
      'section_rankings:read_club','section_rankings:read_lf','section_rankings:read_global'
    )
ON CONFLICT DO NOTHING;
