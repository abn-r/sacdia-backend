-- ============================================================================
-- SACDIA Role-Permissions Seed
-- ============================================================================
-- Idempotent: each role block first DELETEs all existing permissions for that
-- role, then INSERTs the exact set defined here.
-- This makes the seed the SINGLE source of truth — running it produces exactly
-- the permissions listed, no more, no less.
--
-- Run with: psql "$DATABASE_URL" -f prisma/seeds/role-permissions.seed.sql
--
-- Depends on: permissions.seed.sql (permissions must exist first)
--             seed.ts roles (roles must exist first)
-- ============================================================================

BEGIN;

-- ============================================================================
-- LEGACY PERMISSION CLEANUP
-- ============================================================================
-- Phase 3 (permission-scope-cleanup-phase-3): retired broad legacy permissions
-- (`users:update`, `classes:update`, `user_honors:update`) superseded by
-- intent-specific ones (`users:update_profile`, `classes:submit_progress`,
-- `user_honors:submit`/`user_honors:validate`).
--
-- Phase 4 (2026-04-22): retired `classes:validate` — superseded by
-- `validation:review` after the validation domain was canonized. Permission
-- row marked `active=false` in permissions.seed.sql; this DELETE purges any
-- surviving grants in role_permissions.
--
-- Phase 5 (2026-04-28): retired `qr:issue_self` — `/qr/me*` self-service routes
-- no longer enforce a domain permission gate (Option A). JWT auth alone is
-- sufficient since the caller identity is already established by the token.
-- Permission row marked `active=false` in permissions.seed.sql.
--
-- Idempotent: re-runs are no-ops once rows are gone.
DELETE FROM role_permissions
USING permissions p
WHERE role_permissions.permission_id = p.permission_id
  AND p.permission_name IN (
    'users:update',
    'classes:update',
    'user_honors:update',
    'classes:validate',
    'qr:issue_self',
    'folders:read',
    'folders:manage',
    'user_folders:read',
    'user_folders:manage'
  );

-- ============================
-- USER role (GLOBAL)
-- ============================
-- Minimum permissions for a registered user NOT yet in a club (or between clubs).
-- Can manage own profile, personal data, trajectory (honors/classes),
-- browse catalogs, handle post-registration, and view dashboard.
-- Total: 21

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'user' AND role_category = 'GLOBAL' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'user'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    -- Profile & personal data
    'users:read',
    'users:update_profile',
    'emergency_contacts:read',
    'emergency_contacts:update',
    'health:read',
    'health:update',
    'legal_representative:read',
    'legal_representative:update',

    -- Classes & honors (own trajectory)
    'classes:read',
    'user_honors:read',
    'user_honors:create',
    'user_honors:submit',
    'user_honors:delete',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',

    -- Post-registration (club enrollment)
    'post_registration:read',
    'clubs:read',
    'club_sections:read',

    -- Requests (own domain)
    'requests:read',

    -- Dashboard
    'dashboard:read',

    -- Achievements (own progress)
    'achievements:read',

    -- Validation (own domain — Sprint E)
    'validation:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- MEMBER role (CLUB)
-- ============================
-- Least-privilege permissions for a regular club member.
-- Members can view their own data, manage their trajectory (honors/classes),
-- read club info and catalogs, and handle post-registration.

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'member' AND role_category = 'CLUB' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'member'
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    -- Classes & Honors (own trajectory)
    'classes:read',
    'user_honors:read',
    'user_honors:create',
    'user_honors:submit',
    'user_honors:delete',

    -- Club info (read only)
    'clubs:read',
    'club_sections:read',
    'club_instances:read',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',

    -- Personal data
    'users:read',
    'users:update_profile',
    'emergency_contacts:read',
    'emergency_contacts:update',
    'health:read',
    'health:update',
    'legal_representative:read',
    'legal_representative:update',

    -- Activities (read only — attendance:manage intentionally withheld:
    -- members must not be able to mark attendance for other members via
    -- the QR scanner or the legacy attendance endpoint. Scoped to director+
    -- roles only.)
    'activities:read',
    'attendance:read',

    -- Evidence & progress

    -- Units
    'units:read',

    -- Scoring Categories
    'scoring_categories:read',

    -- Member of the Month
    'mom:read',

    -- Post-registration
    'post_registration:read',

    -- Dashboard
    'dashboard:read',

    -- Investiture (read only)
    'investiture:read',

    -- Requests (own domain)
    'requests:read',

    -- Achievements (own progress)
    'achievements:read',

    -- Validation (own domain — Sprint E)
    'validation:read',
    'validation:submit',

    -- Rankings (own ranking — 8.4-A)
    'member_rankings:read_self'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- COUNSELOR role (CLUB)
-- ============================
-- Counselor inherits ALL member permissions plus additional ones
-- for managing their unit members' progress and viewing detailed profiles.
-- Additional over MEMBER: users:read_detail, classes:update, units:update,
-- investiture:submit, club_roles:read, insurance:read

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'counselor' AND role_category = 'CLUB' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'counselor'
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    -- ===== Inherited from MEMBER (28) =====
    -- Classes & Honors (own trajectory)
    'classes:read',
    'user_honors:read',
    'user_honors:create',
    'user_honors:delete',
    'user_honors:submit',
    'user_honors:validate',

    -- Club info (read only)
    'clubs:read',
    'club_sections:read',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',

    -- Personal data
    'users:read',
    'users:update_profile',
    'emergency_contacts:read',
    'emergency_contacts:update',
    'health:read',
    'health:update',
    'legal_representative:read',
    'legal_representative:update',

    -- Activities
    'activities:read',
    'attendance:read',
    'attendance:manage',
    'qr:validate',

    -- Evidence & progress

    -- Units
    'units:read',

    -- Scoring Categories
    'scoring_categories:read',

    -- Post-registration
    'post_registration:read',

    -- Dashboard
    'dashboard:read',

    -- Investiture (read only)
    'investiture:read',

    -- ===== Additional COUNSELOR permissions (6) =====
    -- View detailed profile of club members (honors, classes, emergency, health)
    'users:read_detail',
    -- Validate/return class progress for members in their classes
    'classes:submit_progress',
    -- Assign weekly scores/points for unit meetings
    'units:update',
    -- Scoring Categories (manage)
    'scoring_categories:manage',
    -- Member of the Month
    'mom:read',
    'mom:evaluate',
    -- Submit members as investiture candidates to section leadership
    'investiture:submit',
    -- See member list of the club and their roles
    'club_roles:read',
    -- View insurance status of members they oversee
    'insurance:read',

    -- User progression (view other users' progression — admin-level)
    'user_certifications:read',

    -- Requests (own domain)
    'requests:read',

    -- Achievements (own progress)
    'achievements:read',

    -- Validation (own domain — Sprint E)
    'validation:submit',
    'validation:review',
    'validation:read',

    -- Rankings (own ranking — 8.4-A)
    'member_rankings:read_self'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- INSTRUCTOR role (CLUB)
-- ============================
-- Instructor teaches honors, classes, and specialized skills.
-- Minimal permissions: own trajectory, club read, catalogs, personal data,
-- validation, and own ranking.

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'instructor' AND role_category = 'CLUB' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'instructor'
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    -- Classes & Honors (own trajectory)
    'classes:read',
    'user_honors:read',
    'user_honors:create',
    'user_honors:submit',
    'user_honors:delete',
    'user_honors:validate',

    -- Club info (read only)
    'clubs:read',
    'club_sections:read',
    'club_roles:read',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',

    -- Personal data
    'users:read',
    'users:update_profile',
    'emergency_contacts:read',
    'emergency_contacts:update',
    'health:read',
    'health:update',
    'legal_representative:read',
    'legal_representative:update',

    -- Activities (read + attendance)
    'activities:read',
    'attendance:read',
    'attendance:manage',
    'qr:validate',

    -- Evidence & progress

    -- User progression (view other users' progression)
    'user_certifications:read',

    -- Dashboard
    'dashboard:read',

    -- Investiture (read only)
    'investiture:read',

    -- Requests (own domain)
    'requests:read',

    -- Achievements (own progress)
    'achievements:read',

    -- Validation (own domain — Sprint E)
    'validation:submit',
    'validation:review',
    'validation:read',

    -- Rankings (own ranking — 8.4-A)
    'member_rankings:read_self'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- SECRETARY role (CLUB)
-- ============================
-- Secretary inherits ALL counselor permissions (34) plus additional ones
-- for administrative tasks: club sections, insurance management, activities,
-- reports, club instances, camporee registration, and club info updates.
-- Total: 28 (member) + 6 (counselor) + 13 (secretary) + 4 (inventory) = 51

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'secretary' AND role_category = 'CLUB' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'secretary'
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    -- ===== Inherited from MEMBER (28) =====
    -- Classes & Honors (own trajectory)
    'classes:read',
    'user_honors:read',
    'user_honors:create',
    'user_honors:delete',
    'user_honors:submit',
    'user_honors:validate',

    -- Club info (read only)
    'clubs:read',
    'club_sections:read',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',

    -- Personal data
    'users:read',
    'users:update_profile',
    'emergency_contacts:read',
    'emergency_contacts:update',
    'health:read',
    'health:update',
    'legal_representative:read',
    'legal_representative:update',

    -- Activities
    'activities:read',
    'attendance:read',
    'attendance:manage',
    'qr:validate',

    -- Evidence & progress
    'evidence_folders:read',
    'evidence_folders:update',
    'annual_folders:submit',

    -- Units
    'units:read',

    -- Scoring Categories
    'scoring_categories:read',

    -- Post-registration
    'post_registration:read',

    -- Dashboard
    'dashboard:read',

    -- Investiture (read only)
    'investiture:read',

    -- ===== Inherited from COUNSELOR (6) =====
    -- View detailed profile of club members
    'users:read_detail',
    -- Validate/return class progress
    'classes:submit_progress',
    -- Assign weekly scores/points for unit meetings
    'units:update',
    -- Scoring Categories (manage)
    'scoring_categories:manage',
    -- Member of the Month
    'mom:read',
    'mom:evaluate',
    -- Submit members as investiture candidates
    'investiture:submit',
    -- See member list and roles
    'club_roles:read',
    -- View insurance status
    'insurance:read',

    -- User progression (view other users' progression — admin-level)
    'user_certifications:read',

    -- ===== Additional SECRETARY permissions (13) =====
    -- Club info + section management
    'clubs:update',
    'club_sections:update',
    -- Insurance management (create/update records)
    'insurance:create',
    'insurance:update',
    -- Activity management (create/update club activities)
    'activities:create',
    'activities:update',
    -- Reports (view/preview and download monthly reports)
    'reports:read',
    'reports:download',
    -- Club instances (register and manage yearly club instances)
    'club_instances:create',
    'club_instances:read',
    'club_instances:update',
    -- Camporees (view only; enrollment belongs to territorial organizers)
    'camporees:read',
    -- Camporees management (Sprint D)
    'camporees:create',
    'camporees:update',
    -- Inventory management (CRUD for club inventory items)
    'inventory:read',
    'inventory:create',
    'inventory:update',
    'inventory:delete',
    -- Membership approval
    'club_members:approve',
    'club_members:reject',
    'club_members:list_pending',

    -- Requests (own domain)
    'requests:read',

    -- Achievements (own progress)
    'achievements:read',

    -- Validation (own domain — Sprint E)
    'validation:submit',
    'validation:review',
    'validation:read',

    -- Rankings (own ranking — 8.4-A)
    'member_rankings:read_self'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- TREASURER role (CLUB)
-- ============================
-- Treasurer inherits ALL counselor permissions (34) plus additional ones
-- for financial management: finances CRUD, reports, insurance management,
-- and camporee payment registration.
-- Total: 28 (member) + 6 (counselor) + 10 (treasurer) = 44

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'treasurer' AND role_category = 'CLUB' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'treasurer'
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    -- ===== Inherited from MEMBER (28) =====
    -- Classes & Honors (own trajectory)
    'classes:read',
    'user_honors:read',
    'user_honors:create',
    'user_honors:delete',
    'user_honors:submit',
    'user_honors:validate',

    -- Club info (read only)
    'clubs:read',
    'club_sections:read',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',

    -- Personal data
    'users:read',
    'users:update_profile',
    'emergency_contacts:read',
    'emergency_contacts:update',
    'health:read',
    'health:update',
    'legal_representative:read',
    'legal_representative:update',

    -- Activities
    'activities:read',
    'attendance:read',
    'attendance:manage',
    'qr:validate',

    -- Evidence & progress

    -- Units
    'units:read',

    -- Scoring Categories
    'scoring_categories:read',

    -- Post-registration
    'post_registration:read',

    -- Dashboard
    'dashboard:read',

    -- Investiture (read only)
    'investiture:read',

    -- ===== Inherited from COUNSELOR (6) =====
    -- View detailed profile of club members
    'users:read_detail',
    -- Validate/return class progress
    'classes:submit_progress',
    -- Assign weekly scores/points for unit meetings
    'units:update',
    -- Scoring Categories (manage)
    'scoring_categories:manage',
    -- Member of the Month
    'mom:read',
    'mom:evaluate',
    -- Submit members as investiture candidates
    'investiture:submit',
    -- See member list and roles
    'club_roles:read',
    -- View insurance status
    'insurance:read',

    -- User progression (view other users' progression — admin-level)
    'user_certifications:read',

    -- ===== Additional TREASURER permissions (10) =====
    -- Financial records management (section-level)
    'finances:read',
    'finances:create',
    'finances:update',
    'finances:delete',
    -- Reports (view/preview and download financial reports)
    'reports:read',
    'reports:download',
    -- Insurance management (register and update for section members/staff)
    'insurance:create',
    'insurance:update',
    -- Camporees (view only; enrollment belongs to territorial organizers)
    'camporees:read',
    -- Camporees management (Sprint D)
    'camporees:create',
    'camporees:update',

    -- Requests (own domain)
    'requests:read',

    -- Achievements (own progress)
    'achievements:read',

    -- Validation (own domain — Sprint E)
    'validation:submit',
    'validation:review',
    'validation:read',

    -- Rankings (own ranking — 8.4-A)
    'member_rankings:read_self'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- SECRETARY-TREASURER role (CLUB)
-- ============================
-- Secretary-Treasurer is the UNION of secretary + treasurer permissions.
-- Has all secretary permissions (50) plus treasurer-only ones (finances CRUD).
-- Total: 54

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'secretary-treasurer' AND role_category = 'CLUB' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'secretary-treasurer'
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    -- ===== Inherited from MEMBER (28) =====
    -- Classes & Honors (own trajectory)
    'classes:read',
    'user_honors:read',
    'user_honors:create',
    'user_honors:delete',
    'user_honors:submit',
    'user_honors:validate',

    -- Club info (read only)
    'clubs:read',
    'club_sections:read',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',

    -- Personal data
    'users:read',
    'users:update_profile',
    'emergency_contacts:read',
    'emergency_contacts:update',
    'health:read',
    'health:update',
    'legal_representative:read',
    'legal_representative:update',

    -- Activities
    'activities:read',
    'attendance:read',
    'attendance:manage',
    'qr:validate',

    -- Evidence & progress
    'evidence_folders:read',
    'evidence_folders:update',
    'annual_folders:submit',

    -- Units
    'units:read',

    -- Scoring Categories
    'scoring_categories:read',

    -- Post-registration
    'post_registration:read',

    -- Dashboard
    'dashboard:read',

    -- Investiture (read only)
    'investiture:read',

    -- ===== Inherited from COUNSELOR (6) =====
    'users:read_detail',
    'classes:submit_progress',
    'units:update',
    -- Scoring Categories (manage)
    'scoring_categories:manage',
    -- Member of the Month
    'mom:read',
    'mom:evaluate',
    'investiture:submit',
    'club_roles:read',
    'insurance:read',

    -- ===== From SECRETARY (16) =====
    -- Club ficha + section management
    'clubs:update',
    'club_sections:update',
    -- Insurance management
    'insurance:create',
    'insurance:update',
    -- Activity management
    'activities:create',
    'activities:update',
    -- Reports
    'reports:read',
    'reports:download',
    -- Club instances
    'club_instances:create',
    'club_instances:read',
    'club_instances:update',
    -- Camporees
    'camporees:read',
    -- Camporees management (Sprint D)
    'camporees:create',
    'camporees:update',
    -- Inventory management
    'inventory:read',
    'inventory:create',
    'inventory:update',
    'inventory:delete',

    -- User progression (view other users' progression — admin-level)
    'user_certifications:read',

    -- ===== From TREASURER (4 unique) =====
    -- Financial records management
    'finances:read',
    'finances:create',
    'finances:update',
    'finances:delete',

    -- ===== Membership approval (3) =====
    'club_members:approve',
    'club_members:reject',
    'club_members:list_pending',

    -- Requests (own domain)
    'requests:read',

    -- Achievements (own progress)
    'achievements:read',

    -- Validation (own domain — Sprint E)
    'validation:submit',
    'validation:review',
    'validation:read',

    -- Rankings (own ranking — 8.4-A)
    'member_rankings:read_self'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- DEPUTY-DIRECTOR role (CLUB)
-- ============================
-- Deputy-Director (subdirector/vice-director) inherits ALL counselor permissions (34)
-- plus read-only access to secretary domains, investiture validation,
-- activity management, and financial read access.
-- Total: 34 (counselor) + 9 (additional) = 43

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'deputy-director' AND role_category = 'CLUB' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'deputy-director'
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    -- ===== Inherited from MEMBER (28) =====
    -- Classes & Honors (own trajectory)
    'classes:read',
    'user_honors:read',
    'user_honors:create',
    'user_honors:delete',
    'user_honors:submit',
    'user_honors:validate',

    -- Club info (read only)
    'clubs:read',
    'club_sections:read',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',

    -- Personal data
    'users:read',
    'users:update_profile',
    'emergency_contacts:read',
    'emergency_contacts:update',
    'health:read',
    'health:update',
    'legal_representative:read',
    'legal_representative:update',

    -- Activities
    'activities:read',
    'attendance:read',
    'attendance:manage',
    'qr:validate',

    -- Evidence & progress
    'evidence_folders:read',
    'evidence_folders:update',

    -- Units
    'units:read',

    -- Scoring Categories
    'scoring_categories:read',

    -- Post-registration
    'post_registration:read',

    -- Dashboard
    'dashboard:read',

    -- Investiture (read only)
    'investiture:read',

    -- ===== Inherited from COUNSELOR (6) =====
    'users:read_detail',
    'classes:submit_progress',
    'units:update',
    -- Scoring Categories (manage)
    'scoring_categories:manage',
    -- Member of the Month
    'mom:read',
    'mom:evaluate',
    'investiture:submit',
    'club_roles:read',
    'insurance:read',

    -- User progression (view + manage other users' progression — admin-level)
    'user_certifications:read',
    'user_certifications:manage',

    -- ===== Additional DEPUTY-DIRECTOR permissions =====
    -- Club ficha (PATCH /clubs/:clubId)
    'clubs:update',
    -- Read-only access to secretary domains
    'inventory:read',
    'reports:read',
    'reports:download',
    'club_instances:read',
    'camporees:read',
    -- Camporees management (Sprint D)
    'camporees:create',
    'camporees:update',
    -- Investiture validation (accept/reject from counselors)
    'investiture:validate',
    -- Activity management
    'activities:create',
    'activities:update',
    -- Financial read access (view only)
    'finances:read',
    -- Membership approval
    'club_members:approve',
    'club_members:reject',
    'club_members:list_pending',

    -- Requests (own domain)
    'requests:read',

    -- Achievements (own progress)
    'achievements:read',

    -- Validation (own domain — Sprint E)
    'validation:submit',
    'validation:review',
    'validation:read',

    -- Rankings (own ranking — 8.4-A)
    'member_rankings:read_self',
    'member_rankings:read_section',
    'member_rankings:read_club',
    'section_rankings:read_club'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- DIRECTOR role (CLUB)
-- ============================
-- Director is the UNION of secretary-treasurer + deputy-director permissions,
-- PLUS director-only permissions for activity deletion, role management, and
-- active-section camporee registration.

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'director' AND role_category = 'CLUB' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'director'
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    -- ===== Inherited from MEMBER (28) =====
    -- Classes & Honors (own trajectory)
    'classes:read',
    'user_honors:read',
    'user_honors:create',
    'user_honors:delete',
    'user_honors:submit',
    'user_honors:validate',

    -- Club info (read only)
    'clubs:read',
    'club_sections:read',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',

    -- Personal data
    'users:read',
    'users:update_profile',
    'emergency_contacts:read',
    'emergency_contacts:update',
    'health:read',
    'health:update',
    'legal_representative:read',
    'legal_representative:update',

    -- Activities
    'activities:read',
    'attendance:read',
    'attendance:manage',
    'qr:validate',

    -- Evidence & progress
    'evidence_folders:read',
    'evidence_folders:update',
    'annual_folders:submit',

    -- Units
    'units:read',

    -- Scoring Categories
    'scoring_categories:read',

    -- Post-registration
    'post_registration:read',

    -- Dashboard
    'dashboard:read',

    -- Investiture (read only)
    'investiture:read',

    -- ===== Inherited from COUNSELOR (6) =====
    'users:read_detail',
    'classes:submit_progress',
    'units:update',
    -- Scoring Categories (manage)
    'scoring_categories:manage',
    -- Member of the Month
    'mom:read',
    'mom:evaluate',
    'investiture:submit',
    'club_roles:read',
    'insurance:read',

    -- ===== From SECRETARY (16) =====
    -- Club ficha + section management
    'clubs:update',
    'club_sections:update',
    -- Insurance management
    'insurance:create',
    'insurance:update',
    -- Activity management
    'activities:create',
    'activities:update',
    -- Reports
    'reports:read',
    'reports:download',
    -- Club instances
    'club_instances:create',
    'club_instances:read',
    'club_instances:update',
    -- Camporees
    'camporees:read',
    'camporees:register_active_section',
    -- Camporees management (Sprint D)
    'camporees:create',
    'camporees:update',
    'camporees:delete',
    -- Inventory management
    'inventory:read',
    'inventory:create',
    'inventory:update',
    'inventory:delete',

    -- ===== From TREASURER (4 unique) =====
    -- Financial records management
    'finances:read',
    'finances:create',
    'finances:update',
    'finances:delete',

    -- User progression (view + manage other users' progression — admin-level)
    'user_certifications:read',
    'user_certifications:manage',

    -- ===== From DEPUTY-DIRECTOR (1 unique) =====
    -- Investiture validation (accept/reject from counselors)
    'investiture:validate',

    -- ===== Additional DIRECTOR permissions (3 unique) =====
    -- Delete activities
    'activities:delete',
    -- Assign roles to section members
    'club_roles:assign',
    -- Remove members from section / revoke roles
    'club_roles:revoke',
    -- Membership approval
    'club_members:approve',
    'club_members:reject',
    'club_members:list_pending',

    -- Annual folders & rankings (read-only for club directors)
    'annual_folder_templates:read',
    'rankings:read',
    'award_categories:read',

    -- Requests (own domain)
    'requests:read',
    'requests:review',

    -- Achievements (own progress)
    'achievements:read',

    -- Validation (own domain — Sprint E)
    'validation:submit',
    'validation:review',
    'validation:read',

    -- Rankings (own + club-level — 8.4-A)
    'member_rankings:read_self',
    'member_rankings:read_section',
    'member_rankings:read_club',
    'section_rankings:read_club'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- COORDINATOR role (GLOBAL)
-- ============================
-- Global role that oversees assigned club sections.
-- Can view club info, members, classes, and approve/reject class progress
-- and investiture candidates. Read-heavy with limited write (classes:update,
-- investiture:validate, user_honors:update).
-- Total: 18

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'coordinator' AND role_category = 'GLOBAL' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'coordinator'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    -- Club info (read only)
    'clubs:read',
    'club_sections:read',
    'club_roles:read',

    -- User profiles
    'users:read',
    'users:read_detail',

    -- Classes & progress (read + approve/reject)
    'classes:read',

    -- Investiture (read + validate)
    'investiture:read',
    'investiture:validate',

    -- Evidence & honors (read + validate/reject)
    'evidence_folders:read',
    'user_honors:read',
    'user_honors:validate',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',

    -- Dashboard & tracking (read only)
    'dashboard:read',
    'attendance:read',
    'activities:read',

    -- Requests (own domain)
    'requests:read',

    -- Achievements (read only)
    'achievements:read',

    -- Validation (own domain — Sprint E)
    'validation:review',
    'validation:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- ZONE-COORDINATOR role (GLOBAL)
-- ============================
-- Global role that oversees coordinators across a zone.
-- Has ALL coordinator permissions (18) PLUS the ability to view
-- coordinator profiles (emergency contacts, health, insurance).
-- Total: 18 (coordinator) + 3 (additional) = 21

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'zone-coordinator' AND role_category = 'GLOBAL' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'zone-coordinator'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    -- ===== All COORDINATOR permissions (18) =====
    -- Club info (read only)
    'clubs:read',
    'club_sections:read',
    'club_roles:read',

    -- User profiles
    'users:read',
    'users:read_detail',

    -- Classes & progress (read + approve/reject)
    'classes:read',

    -- Investiture (read + validate)
    'investiture:read',
    'investiture:validate',

    -- Evidence & honors (read + validate/reject)
    'evidence_folders:read',
    'user_honors:read',
    'user_honors:validate',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',

    -- Dashboard & tracking (read only)
    'dashboard:read',
    'attendance:read',
    'activities:read',

    -- ===== Additional ZONE-COORDINATOR permissions (3) =====
    -- View coordinator contact info
    'emergency_contacts:read',
    -- View coordinator health info
    'health:read',
    -- View insurance records
    'insurance:read',

    -- Requests (own domain)
    'requests:read',

    -- Achievements (read only)
    'achievements:read',

    -- Validation (own domain — Sprint E)
    'validation:review',
    'validation:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- GENERAL-COORDINATOR role (GLOBAL)
-- ============================
-- Global role that oversees zone-coordinators and coordinators across
-- the entire local field. Has ALL zone-coordinator permissions.
-- The difference is organizational scope (handled at application level).
-- Total: 21 (same as zone-coordinator)

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'general-coordinator' AND role_category = 'GLOBAL' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'general-coordinator'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    -- ===== All ZONE-COORDINATOR permissions (21) =====
    -- Club info (read only)
    'clubs:read',
    'club_sections:read',
    'club_roles:read',

    -- User profiles
    'users:read',
    'users:read_detail',

    -- Classes & progress (read + approve/reject)
    'classes:read',

    -- Investiture (read + validate)
    'investiture:read',
    'investiture:validate',

    -- Evidence & honors (read + validate/reject)
    'evidence_folders:read',
    'user_honors:read',
    'user_honors:validate',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',

    -- Dashboard & tracking (read only)
    'dashboard:read',
    'attendance:read',
    'activities:read',

    -- Coordinator welfare (from zone-coordinator)
    'emergency_contacts:read',
    'health:read',
    'insurance:read',

    -- Requests (own domain)
    'requests:read',

    -- Achievements (read only)
    'achievements:read',

    -- Validation (own domain — Sprint E)
    'validation:review',
    'validation:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- ASSISTANT-LF role (GLOBAL)
-- ============================
-- Asistente de campo local. Can see EVERYTHING a director sees (58 permissions)
-- PLUS additional field-level permissions: investiture:mark_invested and
-- geographic/organizational read permissions.
-- Total: 58 (director) + 6 (additional) = 64

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'assistant-lf' AND role_category = 'GLOBAL' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'assistant-lf'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    -- ===== All DIRECTOR permissions (58) =====
    -- Classes & Honors (own trajectory)
    'classes:read',
    'user_honors:read',
    'user_honors:create',
    'user_honors:delete',
    'user_honors:submit',
    'user_honors:validate',

    -- Club info (read only)
    'clubs:read',
    'club_sections:read',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',

    -- Personal data
    'users:read',
    'users:update_profile',
    'emergency_contacts:read',
    'emergency_contacts:update',
    'health:read',
    'health:update',
    'legal_representative:read',
    'legal_representative:update',

    -- Activities
    'activities:read',
    'activities:create',
    'activities:update',
    'activities:delete',
    'attendance:read',
    'attendance:manage',
    'qr:validate',

    -- Evidence & progress
    'evidence_folders:read',

    -- Units
    'units:read',
    'units:update',

    -- Scoring Categories
    'scoring_categories:read',
    'scoring_categories:manage',

    -- Member of the Month
    'mom:read',
    'mom:evaluate',
    'mom:supervise',

    -- Post-registration
    'post_registration:read',

    -- Dashboard
    'dashboard:read',

    -- Investiture
    'investiture:read',
    'investiture:submit',
    'investiture:validate',

    -- Counselor-level
    'users:read_detail',
    'club_roles:read',
    'insurance:read',

    -- Secretary-level
    'club_sections:update',
    'insurance:create',
    'insurance:update',
    'reports:read',
    'reports:download',
    'club_instances:create',
    'club_instances:read',
    'club_instances:update',
    'camporees:read',
    'camporees:register',
    -- Camporees management (Sprint D)
    'camporees:create',
    'camporees:update',
    'camporees:delete',
    -- Eventos / rúbricas / clasificación (mismo alcance que camporees:*)
    'camporee_events:read',
    'camporee_events:create',
    'camporee_events:update',
    'camporee_events:delete',
    'inventory:read',
    'inventory:create',
    'inventory:update',
    'inventory:delete',

    -- Treasurer-level
    'finances:read',
    'finances:create',
    'finances:update',
    'finances:delete',

    -- Director-level
    'classes:submit_progress',
    'club_roles:assign',
    'club_roles:revoke',

    -- Membership approval (from director)
    'club_members:approve',
    'club_members:reject',
    'club_members:list_pending',

    -- User progression (view + manage other users' progression — admin-level)
    'user_certifications:read',
    'user_certifications:manage',

    -- ===== Additional ASSISTANT-LF permissions (6) =====
    -- Mark members as invested (field-level authority)
    'investiture:mark_invested',
    -- Geographic/organizational data (field-level visibility)
    'countries:read',
    'unions:read',
    'local_fields:read',
    'churches:read',
    'districts:read',

    -- ===== Annual Folders Scoring (field-level) =====
    'annual_folder_templates:create',
    'annual_folder_templates:read',
    'annual_folder_templates:update',
    'annual_folder_templates:delete',
    'annual_folders:evaluate',
    'award_categories:create',
    'award_categories:read',
    'award_categories:update',
    'award_categories:delete',
    'rankings:read',
    'rankings:recalculate',

    -- ===== Registration assistance (field-level) =====
    -- Allow assistant-lf to complete post-registration steps on behalf of users.
    -- director-lf, assistant-union, director-union, and higher roles inherit
    -- this permission via the JOIN-based copy blocks below.
    'registration:complete',

    -- ===== Requests (own domain) =====
    -- Inherited by director-lf, assistant-union, director-union, assistant-dia,
    -- director-dia via the JOIN-based copy blocks below.
    'requests:read',
    'requests:review',

    -- ===== Achievements (field-level: full management) =====
    -- Inherited by director-lf, assistant-union, director-union, assistant-dia,
    -- director-dia via the JOIN-based copy blocks below.
    'achievements:read',
    'achievements:manage',

    -- ===== Validation (own domain — Sprint E) =====
    -- Inherited by director-lf, assistant-union, director-union, assistant-dia,
    -- director-dia via the JOIN-based copy blocks below.
    'validation:submit',
    'validation:review',
    'validation:read',

    -- ===== User creation (field-level: manual admin-initiated registration) =====
    -- Inherited by director-lf, assistant-union, director-union, assistant-dia,
    -- director-dia via the JOIN-based copy blocks below.
    -- admin and super-admin pick this up automatically via wildcard grants.
    'users:create',
    'users:bulk_create',

    -- ===== Coordination administration =====
    -- Field-level and higher institutional roles can administer zones and
    -- coordinator assignments. Coordinators themselves do not manage this panel.
    'coordination:manage'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- PASTOR role (GLOBAL)
-- ============================
-- Global role assigned to a district. Read-only access across all clubs
-- in the district. Can view members, classes, honors, reports, health,
-- insurance, and emergency contacts. No write permissions.
-- Total: 20

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'pastor' AND role_category = 'GLOBAL' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'pastor'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    -- Club info (read only)
    'clubs:read',
    'club_sections:read',
    'club_roles:read',

    -- User profiles
    'users:read',
    'users:read_detail',

    -- Classes & progress (read only)
    'classes:read',

    -- Honors & evidence (read only)
    'user_honors:read',
    'evidence_folders:read',

    -- Reports (read + download)
    'reports:read',
    'reports:download',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',

    -- Dashboard & tracking (read only)
    'dashboard:read',
    'attendance:read',
    'activities:read',

    -- Investiture (read only)
    'investiture:read',

    -- Member welfare (read only)
    'insurance:read',
    'emergency_contacts:read',
    'health:read',

    -- Requests (own domain)
    'requests:read',

    -- Achievements (read only)
    'achievements:read',

    -- Validation (own domain — Sprint E)
    'validation:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- DIRECTOR-LF role (GLOBAL)
-- ============================
-- Director de campo local. Same permissions as assistant-lf (64).
-- Scope differences are application-level, not permission-level.

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'director-lf' AND role_category = 'GLOBAL' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, rp_src.permission_id
FROM roles r
CROSS JOIN (
  SELECT rp.permission_id
  FROM role_permissions rp
  JOIN roles src ON src.role_id = rp.role_id
  WHERE src.role_name = 'assistant-lf'
    AND src.role_category = 'GLOBAL'
    AND rp.active = true
) rp_src
WHERE r.role_name = 'director-lf'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- ASSISTANT-UNION role (GLOBAL)
-- ============================
-- Asistente de unión. Same permissions as assistant-lf (64).
-- Scope is broader (all local fields in the union) but permissions are identical.

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'assistant-union' AND role_category = 'GLOBAL' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, rp_src.permission_id
FROM roles r
CROSS JOIN (
  SELECT rp.permission_id
  FROM role_permissions rp
  JOIN roles src ON src.role_id = rp.role_id
  WHERE src.role_name = 'assistant-lf'
    AND src.role_category = 'GLOBAL'
    AND rp.active = true
) rp_src
WHERE r.role_name = 'assistant-union'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- DIRECTOR-UNION role (GLOBAL)
-- ============================
-- Director de unión. Same permissions as assistant-union / assistant-lf (64).
-- Scope differences are application-level.

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'director-union' AND role_category = 'GLOBAL' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, rp_src.permission_id
FROM roles r
CROSS JOIN (
  SELECT rp.permission_id
  FROM role_permissions rp
  JOIN roles src ON src.role_id = rp.role_id
  WHERE src.role_name = 'assistant-lf'
    AND src.role_category = 'GLOBAL'
    AND rp.active = true
) rp_src
WHERE r.role_name = 'director-union'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- ASSISTANT-DIA role (GLOBAL)
-- ============================
-- Asistente de división. Same permissions as assistant-lf (64).
-- Scope covers all unions in the division.

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'assistant-dia' AND role_category = 'GLOBAL' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, rp_src.permission_id
FROM roles r
CROSS JOIN (
  SELECT rp.permission_id
  FROM role_permissions rp
  JOIN roles src ON src.role_id = rp.role_id
  WHERE src.role_name = 'assistant-lf'
    AND src.role_category = 'GLOBAL'
    AND rp.active = true
) rp_src
WHERE r.role_name = 'assistant-dia'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- DIRECTOR-DIA role (GLOBAL)
-- ============================
-- Director de división. Same permissions as assistant-dia / assistant-lf (64).
-- Scope differences are application-level.

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'director-dia' AND role_category = 'GLOBAL' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, rp_src.permission_id
FROM roles r
CROSS JOIN (
  SELECT rp.permission_id
  FROM role_permissions rp
  JOIN roles src ON src.role_id = rp.role_id
  WHERE src.role_name = 'assistant-lf'
    AND src.role_category = 'GLOBAL'
    AND rp.active = true
) rp_src
WHERE r.role_name = 'director-dia'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- ADMIN role (GLOBAL)
-- ============================
-- Platform administrator. Has ALL permissions EXCEPT delete permissions.
-- Cannot destroy data, but can manage everything else.
-- Total: 92 (all active permissions minus those ending in :delete)

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'admin' AND role_category = 'GLOBAL' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'admin'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name NOT LIKE '%:delete'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- SUPER_ADMIN role (GLOBAL)
-- ============================
-- Supreme platform administrator. Has ALL permissions, no exceptions.
-- Total: 107 (all active permissions)

DELETE FROM role_permissions
WHERE role_id = (
  SELECT role_id FROM roles
  WHERE role_name = 'super-admin' AND role_category = 'GLOBAL' AND active = true
);

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'super-admin'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- clubs:update — ficha del club (dirección y secretaría)
-- ============================
-- PATCH /clubs/:clubId exige este permiso + ClubRoles. El grant también
-- vive en los IN lists de secretary / secretary-treasurer / deputy / director.
-- Este INSERT lo reafirma después de los DELETE+INSERT por rol.
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('secretary', 'secretary-treasurer', 'deputy-director', 'director')
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'clubs:update'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- units:create / units:delete — create is club management; delete is direction
-- ============================
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('secretary', 'secretary-treasurer', 'deputy-director', 'director', 'treasurer')
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'units:create'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('deputy-director', 'director')
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'units:delete'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- materiales:* — club leadership orders + territorial review
-- ============================
-- Must live here: role blocks DELETE+INSERT wipe grants from the 20260513
-- migration if they are not re-asserted after every seed run.
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director', 'deputy-director', 'secretary', 'secretary-treasurer')
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    'materiales:read',
    'materiales:create',
    'materiales:upload-receipt'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN (
    'assistant-lf', 'director-lf',
    'assistant-union', 'director-union',
    'assistant-dia', 'director-dia'
  )
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    'materiales:read',
    'materiales:approve',
    'materiales:validate-receipt',
    'materiales:deliver',
    'materiales:manage-inventory',
    'materiales:configure'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- notifications:club — active club section leadership
-- ============================
-- Direct/broadcast notification permissions stay global-admin only:
-- admin and super-admin pick them up automatically via the wildcard grants above.
-- Club notification send is deliberately scoped to the actor's active club
-- assignment, and granted only to section leadership roles.
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('secretary', 'secretary-treasurer', 'deputy-director', 'director')
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'notifications:club'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- attendance:approve_late — field/union directors and assistants
-- ============================
-- Grant to: director-lf, assistant-lf, director-union, assistant-union (all GLOBAL)
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf', 'director-union', 'assistant-union')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'attendance:approve_late'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- resources:read + resource_categories:read — club operational read access
-- ============================
-- Replaces the retired legacy `folders:read` gate for shared resources.
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE (
    (r.role_name = 'user' AND r.role_category = 'GLOBAL')
    OR (r.role_name IN ('member', 'counselor', 'instructor', 'secretary', 'treasurer', 'secretary-treasurer', 'deputy-director', 'director')
        AND r.role_category = 'CLUB')
  )
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN ('resources:read', 'resource_categories:read')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- resources:* — field/union/dia directors and assistants
-- ============================
-- admin and super-admin pick these up automatically via their wildcard grants.
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf', 'director-union', 'assistant-union', 'director-dia', 'assistant-dia')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN ('resources:create', 'resources:read', 'resources:update', 'resources:delete')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- resource_categories:* — same roles for category management
-- ============================
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf', 'director-union', 'assistant-union', 'director-dia', 'assistant-dia')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN ('resource_categories:create', 'resource_categories:read', 'resource_categories:update', 'resource_categories:delete')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- resources:read + resource_categories:read for coordinator role (read-only access)
-- ============================
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'coordinator'
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN ('resources:read', 'resource_categories:read')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- mom:supervise for coordinator roles
-- Scoped at runtime to coordinator_assignments (club_section_ids), not local_field.
-- ============================
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('coordinator', 'zone-coordinator', 'general-coordinator')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'mom:supervise'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- annual_folders:submit — club direction/secretariat only
-- ============================
-- Folder-level submit is granted in the director/secretary role blocks above.
-- Coordinators and institutional supervisors evaluate/supervise, but they do
-- not send the club's complete folder on its behalf.

-- ============================
-- ranking_weights:* — 8.4-C grants
-- ============================
-- super-admin and admin pick up both permissions automatically via their
-- wildcard grants above (super-admin: all active; admin: all active except :delete).
--
-- Union-level roles (director-union, assistant-union): read + write.
-- These roles copy permissions from assistant-lf which uses an explicit list,
-- so they do NOT pick up new permissions automatically.
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-union', 'assistant-union')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN ('ranking_weights:read', 'ranking_weights:write')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- camporee_events:* — LF/Unión manage events, rubrics and leaderboard.
-- assistant-lf lists them explicitly; this restore also covers live DBs whose
-- director-lf copy ran before those grants existed (DELETE+COPY wipes extras).
INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN (
  'assistant-lf',
  'director-lf',
  'assistant-union',
  'director-union'
)
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    'camporee_events:read',
    'camporee_events:create',
    'camporee_events:update',
    'camporee_events:delete'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- 8.4-C: ranking_weights:read for GLOBAL field/dia leaders
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf', 'director-dia', 'assistant-dia')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'ranking_weights:read'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 8.4-C: ranking_weights:read for CLUB-scope club director
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name = 'director'
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'ranking_weights:read'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- `camporees:register_active_section` is intentionally narrower than the
-- platform-admin wildcards above: only a CLUB director may register their
-- currently active section. Re-seeding also removes any stale or accidental
-- grant to every other role.
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name = 'camporees:register_active_section'
  AND NOT (
    r.role_name = 'director'
    AND r.role_category = 'CLUB'
  );

-- `camporees:register` is reserved for territorial Camporee organizers.
-- This cleanup runs after inheritance and platform-admin wildcard grants so
-- no CLUB, division, admin, or super-admin role retains the capability.
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name = 'camporees:register'
  AND NOT (
    r.role_name IN ('assistant-lf', 'director-lf', 'assistant-union', 'director-union')
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (
  role_permission_id,
  role_id,
  permission_id,
  active
)
SELECT
  gen_random_uuid(),
  r.role_id,
  p.permission_id,
  true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('assistant-lf', 'director-lf', 'assistant-union', 'director-union')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'camporees:register'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- Insurance configuration is intentionally restricted to Local Field
-- leadership. This cleanup runs after all inherited/global role grants so
-- assistant/director union, DIA, admin and club roles cannot receive it.
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name = 'insurance:configure'
  AND NOT (
    r.role_name IN ('assistant-lf', 'director-lf')
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (
  role_permission_id,
  role_id,
  permission_id,
  active
)
SELECT
  gen_random_uuid(),
  r.role_id,
  p.permission_id,
  true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('assistant-lf', 'director-lf')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'insurance:configure'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- Purchase review is a separate capability from configuration. It is granted
-- only to Local Field leadership and platform administrators; assistant-admin
-- is intentionally excluded even if broad inherited grants exist.
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name = 'insurance:review'
  AND NOT (
    r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (
  role_permission_id,
  role_id,
  permission_id,
  active
)
SELECT
  gen_random_uuid(),
  r.role_id,
  p.permission_id,
  true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'insurance:review'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- Certification configuration/publish are restricted to Local Field
-- leadership. Admin/super-admin already receive these via their broad
-- wildcard grants, so this cleanup only needs to scope out other roles that
-- might have inherited them through global grants.
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name IN ('certifications:configure', 'certifications:publish')
  AND NOT (
    r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (
  role_permission_id,
  role_id,
  permission_id,
  active
)
SELECT
  gen_random_uuid(),
  r.role_id,
  p.permission_id,
  true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN ('certifications:configure', 'certifications:publish')
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- Certification review/certify follow the same Local Field + platform admin
-- pattern as insurance:review.
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name IN ('certifications:review', 'certifications:certify')
  AND NOT (
    r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (
  role_permission_id,
  role_id,
  permission_id,
  active
)
SELECT
  gen_random_uuid(),
  r.role_id,
  p.permission_id,
  true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN ('certifications:review', 'certifications:certify')
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

COMMIT;

-- ============================================================================
-- Verification
-- ============================================================================
SELECT
  r.role_name,
  r.role_category,
  COUNT(*) AS permission_count
FROM role_permissions rp
JOIN roles r ON rp.role_id = r.role_id
WHERE rp.active = true
GROUP BY r.role_name, r.role_category
ORDER BY permission_count, r.role_name;

-- Ensure Camporee event read access for club operational roles (mobile detail).
INSERT INTO role_permissions (role_permission_id, role_id, permission_id)
SELECT gen_random_uuid(), r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN (
    'director',
    'deputy-director',
    'secretary',
    'secretary-treasurer',
    'treasurer',
    'counselor'
  )
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.permission_name = 'camporee_events:read'
  AND p.active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================================
-- Field Payment Orders (órdenes de pago territoriales)
-- ============================================================================
-- read: mirrors insurance:read (club operational roles + territorial readers).
INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN (
    'counselor', 'secretary', 'treasurer', 'secretary-treasurer',
    'deputy-director', 'director'
  )
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'field-payment-orders:read'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('assistant-lf', 'director-lf')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'field-payment-orders:read'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- create / upload-proof / cancel: mirrors insurance:create (club directive
-- roles that operate money) + LF leadership.
INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('secretary', 'treasurer', 'secretary-treasurer', 'director')
  AND r.role_category = 'CLUB'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    'field-payment-orders:create',
    'field-payment-orders:upload-proof',
    'field-payment-orders:cancel'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('assistant-lf', 'director-lf')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name IN (
    'field-payment-orders:create',
    'field-payment-orders:upload-proof',
    'field-payment-orders:cancel'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- review: same Local Field + platform admin pattern as insurance:review.
-- Maker-checker is enforced in the service (proof uploader cannot approve).
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name = 'field-payment-orders:review'
  AND NOT (
    r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'field-payment-orders:review'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();

-- configure: Local Field payment instructions (bank/cashier), same grantees
-- as review (LF leadership + platform admins).
DELETE FROM role_permissions rp
USING permissions p, roles r
WHERE rp.permission_id = p.permission_id
  AND rp.role_id = r.role_id
  AND p.permission_name = 'field-payment-orders:configure'
  AND NOT (
    r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
    AND r.role_category = 'GLOBAL'
  );

INSERT INTO role_permissions (role_permission_id, role_id, permission_id, active)
SELECT gen_random_uuid(), r.role_id, p.permission_id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.role_name IN ('director-lf', 'assistant-lf', 'admin', 'super-admin')
  AND r.role_category = 'GLOBAL'
  AND r.active = true
  AND p.active = true
  AND p.permission_name = 'field-payment-orders:configure'
ON CONFLICT (role_id, permission_id) DO UPDATE SET
  active = true,
  modified_at = now();
