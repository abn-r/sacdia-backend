-- ============================================================================
-- SACDIA Role-Permissions Seed
-- ============================================================================
-- Idempotent: uses INSERT ... ON CONFLICT DO NOTHING.
-- Run with: psql "$DATABASE_URL" -f prisma/seeds/role-permissions.seed.sql
--
-- Depends on: permissions.seed.sql (permissions must exist first)
--             seed.ts roles (roles must exist first)
-- ============================================================================

BEGIN;

-- ============================
-- USER role (GLOBAL)
-- ============================
-- Minimum permissions for a registered user NOT yet in a club (or between clubs).
-- Can manage own profile, personal data, trajectory (honors/classes),
-- browse catalogs, handle post-registration, and view dashboard.
-- Total: 21

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
    'users:update',
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
    'user_honors:update',
    'user_honors:delete',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',
    'folders:read',

    -- Post-registration (club enrollment)
    'post_registration:read',
    'post_registration:update',
    'clubs:read',
    'club_sections:read',

    -- Dashboard
    'dashboard:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- MEMBER role (CLUB)
-- ============================
-- Least-privilege permissions for a regular club member.
-- Members can view their own data, manage their trajectory (honors/classes),
-- read club info and catalogs, and handle post-registration.

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
    'user_honors:update',
    'user_honors:delete',

    -- Club info (read only)
    'clubs:read',
    'club_sections:read',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',
    'folders:read',

    -- Personal data
    'users:read',
    'users:update',
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

    -- Evidence & progress
    'evidence_folders:read',
    'evidence_folders:update',

    -- Units
    'units:read',

    -- Post-registration
    'post_registration:read',
    'post_registration:update',

    -- Dashboard
    'dashboard:read',

    -- Investiture (read only)
    'investiture:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- COUNSELOR role (CLUB)
-- ============================
-- Counselor inherits ALL member permissions plus additional ones
-- for managing their unit members' progress and viewing detailed profiles.
-- Additional over MEMBER: users:read_detail, classes:update, units:update,
-- investiture:submit, club_roles:read, insurance:read

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
    'user_honors:update',
    'user_honors:delete',

    -- Club info (read only)
    'clubs:read',
    'club_sections:read',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',
    'folders:read',

    -- Personal data
    'users:read',
    'users:update',
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

    -- Evidence & progress
    'evidence_folders:read',
    'evidence_folders:update',

    -- Units
    'units:read',

    -- Post-registration
    'post_registration:read',
    'post_registration:update',

    -- Dashboard
    'dashboard:read',

    -- Investiture (read only)
    'investiture:read',

    -- ===== Additional COUNSELOR permissions (6) =====
    -- View detailed profile of club members (honors, classes, emergency, health)
    'users:read_detail',
    -- Validate/return class progress for members in their classes
    'classes:update',
    -- Assign weekly scores/points for unit meetings
    'units:update',
    -- Submit members as investiture candidates to section leadership
    'investiture:submit',
    -- See member list of the club and their roles
    'club_roles:read',
    -- View insurance status of members they oversee
    'insurance:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- SECRETARY role (CLUB)
-- ============================
-- Secretary inherits ALL counselor permissions (34) plus additional ones
-- for administrative tasks: club sections, insurance management, activities,
-- reports, club instances, and camporee registration.
-- Total: 28 (member) + 6 (counselor) + 12 (secretary) + 4 (inventory) = 50

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
    'user_honors:update',
    'user_honors:delete',

    -- Club info (read only)
    'clubs:read',
    'club_sections:read',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',
    'folders:read',

    -- Personal data
    'users:read',
    'users:update',
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

    -- Evidence & progress
    'evidence_folders:read',
    'evidence_folders:update',

    -- Units
    'units:read',

    -- Post-registration
    'post_registration:read',
    'post_registration:update',

    -- Dashboard
    'dashboard:read',

    -- Investiture (read only)
    'investiture:read',

    -- ===== Inherited from COUNSELOR (6) =====
    -- View detailed profile of club members
    'users:read_detail',
    -- Validate/return class progress
    'classes:update',
    -- Assign weekly scores/points for unit meetings
    'units:update',
    -- Submit members as investiture candidates
    'investiture:submit',
    -- See member list and roles
    'club_roles:read',
    -- View insurance status
    'insurance:read',

    -- ===== Additional SECRETARY permissions (12) =====
    -- Club section management
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
    -- Camporees (view and register club to camporees)
    'camporees:read',
    'camporees:register',
    -- Inventory management (CRUD for club inventory items)
    'inventory:read',
    'inventory:create',
    'inventory:update',
    'inventory:delete',
    -- Membership approval
    'club_members:approve',
    'club_members:reject',
    'club_members:list_pending'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- TREASURER role (CLUB)
-- ============================
-- Treasurer inherits ALL counselor permissions (34) plus additional ones
-- for financial management: finances CRUD, reports, insurance management,
-- and camporee payment registration.
-- Total: 28 (member) + 6 (counselor) + 10 (treasurer) = 44

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
    'user_honors:update',
    'user_honors:delete',

    -- Club info (read only)
    'clubs:read',
    'club_sections:read',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',
    'folders:read',

    -- Personal data
    'users:read',
    'users:update',
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

    -- Evidence & progress
    'evidence_folders:read',
    'evidence_folders:update',

    -- Units
    'units:read',

    -- Post-registration
    'post_registration:read',
    'post_registration:update',

    -- Dashboard
    'dashboard:read',

    -- Investiture (read only)
    'investiture:read',

    -- ===== Inherited from COUNSELOR (6) =====
    -- View detailed profile of club members
    'users:read_detail',
    -- Validate/return class progress
    'classes:update',
    -- Assign weekly scores/points for unit meetings
    'units:update',
    -- Submit members as investiture candidates
    'investiture:submit',
    -- See member list and roles
    'club_roles:read',
    -- View insurance status
    'insurance:read',

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
    -- Camporees (view and register payments for attendees)
    'camporees:read',
    'camporees:register'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- SECRETARY-TREASURER role (CLUB)
-- ============================
-- Secretary-Treasurer is the UNION of secretary + treasurer permissions.
-- Has all secretary permissions (50) plus treasurer-only ones (finances CRUD).
-- Total: 54

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
    'user_honors:update',
    'user_honors:delete',

    -- Club info (read only)
    'clubs:read',
    'club_sections:read',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',
    'folders:read',

    -- Personal data
    'users:read',
    'users:update',
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

    -- Evidence & progress
    'evidence_folders:read',
    'evidence_folders:update',

    -- Units
    'units:read',

    -- Post-registration
    'post_registration:read',
    'post_registration:update',

    -- Dashboard
    'dashboard:read',

    -- Investiture (read only)
    'investiture:read',

    -- ===== Inherited from COUNSELOR (6) =====
    'users:read_detail',
    'classes:update',
    'units:update',
    'investiture:submit',
    'club_roles:read',
    'insurance:read',

    -- ===== From SECRETARY (16) =====
    -- Club section management
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
    'camporees:register',
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

    -- ===== Membership approval (3) =====
    'club_members:approve',
    'club_members:reject',
    'club_members:list_pending'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- DEPUTY-DIRECTOR role (CLUB)
-- ============================
-- Deputy-Director (subdirector/vice-director) inherits ALL counselor permissions (34)
-- plus read-only access to secretary domains, investiture validation,
-- activity management, and financial read access.
-- Total: 34 (counselor) + 9 (additional) = 43

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
    'user_honors:update',
    'user_honors:delete',

    -- Club info (read only)
    'clubs:read',
    'club_sections:read',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',
    'folders:read',

    -- Personal data
    'users:read',
    'users:update',
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

    -- Evidence & progress
    'evidence_folders:read',
    'evidence_folders:update',

    -- Units
    'units:read',

    -- Post-registration
    'post_registration:read',
    'post_registration:update',

    -- Dashboard
    'dashboard:read',

    -- Investiture (read only)
    'investiture:read',

    -- ===== Inherited from COUNSELOR (6) =====
    'users:read_detail',
    'classes:update',
    'units:update',
    'investiture:submit',
    'club_roles:read',
    'insurance:read',

    -- ===== Additional DEPUTY-DIRECTOR permissions (9) =====
    -- Read-only access to secretary domains
    'inventory:read',
    'reports:read',
    'reports:download',
    'club_instances:read',
    'camporees:read',
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
    'club_members:list_pending'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- DIRECTOR role (CLUB)
-- ============================
-- Director is the UNION of secretary-treasurer + deputy-director permissions,
-- PLUS additional director-only permissions for activity deletion and role management.
-- Total: 54 (secretary-treasurer) + 1 (deputy-director unique) + 3 (director unique) = 58

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
    'user_honors:update',
    'user_honors:delete',

    -- Club info (read only)
    'clubs:read',
    'club_sections:read',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',
    'folders:read',

    -- Personal data
    'users:read',
    'users:update',
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

    -- Evidence & progress
    'evidence_folders:read',
    'evidence_folders:update',

    -- Units
    'units:read',

    -- Post-registration
    'post_registration:read',
    'post_registration:update',

    -- Dashboard
    'dashboard:read',

    -- Investiture (read only)
    'investiture:read',

    -- ===== Inherited from COUNSELOR (6) =====
    'users:read_detail',
    'classes:update',
    'units:update',
    'investiture:submit',
    'club_roles:read',
    'insurance:read',

    -- ===== From SECRETARY (16) =====
    -- Club section management
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
    'camporees:register',
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
    'award_categories:read'
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
    'classes:update',

    -- Investiture (read + validate)
    'investiture:read',
    'investiture:validate',

    -- Evidence & honors (read + validate/reject)
    'evidence_folders:read',
    'user_honors:read',
    'user_honors:update',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',
    'folders:read',

    -- Dashboard & tracking (read only)
    'dashboard:read',
    'attendance:read',
    'activities:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- ZONE-COORDINATOR role (GLOBAL)
-- ============================
-- Global role that oversees coordinators across a zone.
-- Has ALL coordinator permissions (18) PLUS the ability to view
-- coordinator profiles (emergency contacts, health, insurance).
-- Total: 18 (coordinator) + 3 (additional) = 21

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
    'classes:update',

    -- Investiture (read + validate)
    'investiture:read',
    'investiture:validate',

    -- Evidence & honors (read + validate/reject)
    'evidence_folders:read',
    'user_honors:read',
    'user_honors:update',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',
    'folders:read',

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
    'insurance:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- GENERAL-COORDINATOR role (GLOBAL)
-- ============================
-- Global role that oversees zone-coordinators and coordinators across
-- the entire local field. Has ALL zone-coordinator permissions.
-- The difference is organizational scope (handled at application level).
-- Total: 21 (same as zone-coordinator)

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
    'classes:update',

    -- Investiture (read + validate)
    'investiture:read',
    'investiture:validate',

    -- Evidence & honors (read + validate/reject)
    'evidence_folders:read',
    'user_honors:read',
    'user_honors:update',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',
    'folders:read',

    -- Dashboard & tracking (read only)
    'dashboard:read',
    'attendance:read',
    'activities:read',

    -- Coordinator welfare (from zone-coordinator)
    'emergency_contacts:read',
    'health:read',
    'insurance:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- ASSISTANT-LF role (GLOBAL)
-- ============================
-- Asistente de campo local. Can see EVERYTHING a director sees (58 permissions)
-- PLUS additional field-level permissions: investiture:mark_invested and
-- geographic/organizational read permissions.
-- Total: 58 (director) + 6 (additional) = 64

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
    'user_honors:update',
    'user_honors:delete',

    -- Club info (read only)
    'clubs:read',
    'club_sections:read',

    -- Catalogs (read only)
    'catalogs:read',
    'certifications:read',
    'folders:read',

    -- Personal data
    'users:read',
    'users:update',
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

    -- Evidence & progress
    'evidence_folders:read',
    'evidence_folders:update',

    -- Units
    'units:read',
    'units:update',

    -- Post-registration
    'post_registration:read',
    'post_registration:update',

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
    'classes:update',
    'club_roles:assign',
    'club_roles:revoke',

    -- Membership approval (from director)
    'club_members:approve',
    'club_members:reject',
    'club_members:list_pending',

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
    'rankings:recalculate'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- PASTOR role (GLOBAL)
-- ============================
-- Global role assigned to a district. Read-only access across all clubs
-- in the district. Can view members, classes, honors, reports, health,
-- insurance, and emergency contacts. No write permissions.
-- Total: 20

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
    'folders:read',

    -- Dashboard & tracking (read only)
    'dashboard:read',
    'attendance:read',
    'activities:read',

    -- Investiture (read only)
    'investiture:read',

    -- Member welfare (read only)
    'insurance:read',
    'emergency_contacts:read',
    'health:read'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================
-- DIRECTOR-LF role (GLOBAL)
-- ============================
-- Director de campo local. Same permissions as assistant-lf (64).
-- Scope differences are application-level, not permission-level.

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
-- SUPER-ADMIN role (GLOBAL)
-- ============================
-- Supreme platform administrator. Has ALL permissions, no exceptions.
-- Total: 107 (all active permissions)

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
