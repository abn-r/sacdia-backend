-- ============================================================================
-- SACDIA Permissions Seed
-- ============================================================================
-- Idempotent: uses INSERT ... ON CONFLICT DO UPDATE (upsert).
-- Run with: psql "$DATABASE_URL" -f prisma/seeds/permissions.seed.sql
--
-- Format: resource:action
-- Every permission here is referenced by @RequirePermissions() or
-- @SensitiveUserSubresource() decorators in the NestJS controllers.
-- ============================================================================

BEGIN;

-- ============================
-- Clubs
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('clubs:read', 'Read club information', true),
  ('clubs:create', 'Create new clubs', true),
  ('clubs:update', 'Update club information', true),
  ('clubs:delete', 'Delete clubs', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Club Sections
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('club_sections:read', 'Read club sections', true),
  ('club_sections:create', 'Create club sections', true),
  ('club_sections:update', 'Update club sections', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Club Roles
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('club_roles:read', 'Read club role assignments', true),
  ('club_roles:assign', 'Assign club roles to members', true),
  ('club_roles:revoke', 'Revoke club roles from members', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Users
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('users:read', 'Read basic user list', true),
  ('users:read_detail', 'Read detailed user information', true),
  ('users:update', 'Update user information', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Classes
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('classes:read', 'Read class information', true),
  ('classes:update', 'Update class information and progress', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Activities
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('activities:read', 'Read activities', true),
  ('activities:create', 'Create new activities', true),
  ('activities:update', 'Update activities', true),
  ('activities:delete', 'Delete activities', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Attendance
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('attendance:read', 'Read attendance records', true),
  ('attendance:manage', 'Manage attendance (mark, update)', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Finances
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('finances:read', 'Read financial records', true),
  ('finances:create', 'Create financial records', true),
  ('finances:update', 'Update financial records', true),
  ('finances:delete', 'Delete financial records', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Inventory
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('inventory:read', 'Read inventory items', true),
  ('inventory:create', 'Create inventory items', true),
  ('inventory:update', 'Update inventory items', true),
  ('inventory:delete', 'Delete inventory items', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Notifications
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('notifications:send', 'Send notifications to specific users', true),
  ('notifications:broadcast', 'Broadcast notifications to all users', true),
  ('notifications:club', 'Send notifications to club members', true),
  ('notifications:read_history', 'Read notification history', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Units
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('units:read', 'Read units', true),
  ('units:create', 'Create new units', true),
  ('units:update', 'Update units and membership', true),
  ('units:delete', 'Delete units', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- RBAC (Permissions & Roles management)
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('permissions:read', 'Read permissions list', true),
  ('permissions:assign', 'Assign or revoke permissions to roles/users', true),
  ('roles:read', 'Read roles list', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Catalogs (Reference data)
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('catalogs:read', 'Read catalog reference data', true),
  ('catalogs:create', 'Create catalog entries', true),
  ('catalogs:update', 'Update catalog entries', true),
  ('catalogs:delete', 'Delete catalog entries', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Honor Categories
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('honor_categories:read', 'Read honor categories', true),
  ('honor_categories:create', 'Create honor categories', true),
  ('honor_categories:update', 'Update honor categories', true),
  ('honor_categories:delete', 'Delete honor categories', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Ecclesiastical Years
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('ecclesiastical_years:read', 'Read ecclesiastical years', true),
  ('ecclesiastical_years:create', 'Create ecclesiastical years', true),
  ('ecclesiastical_years:update', 'Update ecclesiastical years', true),
  ('ecclesiastical_years:delete', 'Delete ecclesiastical years', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Geography: Countries
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('countries:read', 'Read countries', true),
  ('countries:create', 'Create countries', true),
  ('countries:update', 'Update countries', true),
  ('countries:delete', 'Delete countries', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Geography: Unions
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('unions:read', 'Read unions', true),
  ('unions:create', 'Create unions', true),
  ('unions:update', 'Update unions', true),
  ('unions:delete', 'Delete unions', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Geography: Local Fields
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('local_fields:read', 'Read local fields (conferences/missions)', true),
  ('local_fields:create', 'Create local fields', true),
  ('local_fields:update', 'Update local fields and districts', true),
  ('local_fields:delete', 'Delete local fields and districts', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Geography: Churches
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('churches:read', 'Read churches', true),
  ('churches:create', 'Create churches', true),
  ('churches:update', 'Update churches', true),
  ('churches:delete', 'Delete churches', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Insurance
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('insurance:read', 'Read insurance records', true),
  ('insurance:create', 'Create insurance records', true),
  ('insurance:update', 'Update insurance records', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Evidence Folders
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('evidence_folders:read', 'Read evidence folders and files', true),
  ('evidence_folders:update', 'Upload/delete evidence files', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Annual Folder Templates
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('annual_folder_templates:create', 'Create annual folder templates', true),
  ('annual_folder_templates:read', 'Read annual folder templates', true),
  ('annual_folder_templates:update', 'Update annual folder templates', true),
  ('annual_folder_templates:delete', 'Delete annual folder templates', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Annual Folders Evaluation
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('annual_folders:evaluate', 'Evaluate annual folder sections (assign points)', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Award Categories
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('award_categories:create', 'Create award categories', true),
  ('award_categories:read', 'Read award categories', true),
  ('award_categories:update', 'Update award categories', true),
  ('award_categories:delete', 'Delete award categories', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Rankings
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('rankings:read', 'View club rankings and leaderboards', true),
  ('rankings:recalculate', 'Trigger rankings recalculation', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Investiture
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('investiture:submit', 'Submit enrollment for investiture validation', true),
  ('investiture:validate', 'Validate investiture submissions', true),
  ('investiture:mark_invested', 'Mark member as invested', true),
  ('investiture:read', 'Read investiture history and pending', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Investiture Configuration
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('investiture_config:read', 'Read investiture configuration', true),
  ('investiture_config:create', 'Create investiture configuration', true),
  ('investiture_config:update', 'Update investiture configuration', true),
  ('investiture_config:delete', 'Delete investiture configuration', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Certifications
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('certifications:read', 'Browse certifications catalog', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Folders
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('folders:read', 'Browse folders catalog', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Geography: Districts
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('districts:read', 'Read districts', true),
  ('districts:create', 'Create districts', true),
  ('districts:update', 'Update districts', true),
  ('districts:delete', 'Delete districts', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- User Honors
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('user_honors:read', 'Read user honor records', true),
  ('user_honors:create', 'Create user honor records', true),
  ('user_honors:update', 'Update user honor records', true),
  ('user_honors:delete', 'Delete user honor records', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Dashboard
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('dashboard:read', 'Read dashboard summary', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Sensitive User Subresources (fine-grained)
-- Generated by @SensitiveUserSubresource(family, mode) decorator.
-- These also fall back to users:read_detail / users:update in the guard.
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('health:read', 'Read user health information', true),
  ('health:update', 'Update user health information', true),
  ('emergency_contacts:read', 'Read user emergency contacts', true),
  ('emergency_contacts:update', 'Update user emergency contacts', true),
  ('legal_representative:read', 'Read user legal representative info', true),
  ('legal_representative:update', 'Update user legal representative info', true),
  ('post_registration:read', 'Read user post-registration data', true),
  ('post_registration:update', 'Update user post-registration data', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Reports
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('reports:read', 'View and preview monthly reports', true),
  ('reports:download', 'Download generated reports', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Club Instances
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('club_instances:create', 'Register new club instance each year', true),
  ('club_instances:read', 'View club instance information', true),
  ('club_instances:update', 'Update club instance information', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Club Members (Membership Approval)
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('club_members:approve', 'Aprobar solicitudes de membresía', true),
  ('club_members:reject', 'Rechazar solicitudes de membresía', true),
  ('club_members:list_pending', 'Ver solicitudes de membresía pendientes', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Camporees
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('camporees:read', 'View camporees information', true),
  ('camporees:register', 'Register/enroll club to camporees', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Camporee Late Enrollment
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('attendance:approve_late', 'Approve or reject late camporee enrollments', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Resources
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('resources:create', 'Create resources', true),
  ('resources:read', 'Read resources', true),
  ('resources:update', 'Update resources', true),
  ('resources:delete', 'Delete resources', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

-- ============================
-- Resource Categories
-- ============================
INSERT INTO permissions (permission_name, description, active) VALUES
  ('resource_categories:create', 'Create resource categories', true),
  ('resource_categories:read', 'Read resource categories', true),
  ('resource_categories:update', 'Update resource categories', true),
  ('resource_categories:delete', 'Delete resource categories', true)
ON CONFLICT (permission_name) DO UPDATE SET
  description = EXCLUDED.description,
  active = EXCLUDED.active,
  modified_at = now();

COMMIT;

-- ============================================================================
-- Verification
-- ============================================================================
SELECT COUNT(*) AS total_permissions FROM permissions WHERE active = true;
