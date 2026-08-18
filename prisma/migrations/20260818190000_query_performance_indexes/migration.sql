-- Migration: 20260818190000_query_performance_indexes
-- Indexes for search/filter hot paths that currently sequential-scan large tables.
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction; Prisma migrate
-- detects CONCURRENTLY and executes this migration outside a transaction.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- Analytics SLA / throughput (investiture_validation_history)
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_investiture_history_enrollment_created
  ON investiture_validation_history (enrollment_id, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_investiture_history_action_created
  ON investiture_validation_history (action, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_investiture_history_investido_enrollment
  ON investiture_validation_history (enrollment_id)
  WHERE action = 'INVESTIDO';

-- ============================================================
-- Weekly records / member-of-month / annual folder scores
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_weekly_records_user_year_week
  ON weekly_records (user_id, year, week);

-- ============================================================
-- Honors catalog (active + category ORDER BY name)
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_honors_active_category_name
  ON honors (active, honors_category_id, name);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_honors_club_type_active
  ON honors (club_type_id, active);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_honors_honor_active
  ON users_honors (honor_id, active);

-- ============================================================
-- Clubs / geography FK filters and ORDER BY name
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clubs_church_id
  ON clubs (church_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clubs_district_active
  ON clubs (districlub_type_id, active);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clubs_active_name
  ON clubs (active, name);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clubs_name_trgm
  ON clubs USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_churches_district_active
  ON churches (districlub_type_id, active);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_districts_local_field_active
  ON districts (local_field_id, active);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_local_fields_union_active
  ON local_fields (union_id, active);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_club_sections_club_type_active
  ON club_sections (club_type_id, active);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_classes_club_type_active
  ON classes (club_type_id, active);

-- ============================================================
-- Camporees
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_local_camporees_local_field_active
  ON local_camporees (local_field_id, active);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_union_camporees_union_active
  ON union_camporees (union_id, active);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_camporee_clubs_camporee_id
  ON camporee_clubs (camporee_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_camporee_clubs_club_id
  ON camporee_clubs (club_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_camporee_clubs_status_active
  ON camporee_clubs (status, active);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_camporee_payments_status_paid_at
  ON camporee_payments (status, paid_at);

-- ============================================================
-- Activities / folder assignments / enrollments
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_created_by
  ON activities (created_by);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_created_at
  ON activities (created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activities_created_by_date
  ON activities (created_by, activity_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folder_assignments_user_id
  ON folder_assignments (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folder_assignments_folder_id
  ON folder_assignments (folder_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_class_module_progress_enrollment_id
  ON class_module_progress (enrollment_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_class_section_progress_user_created
  ON class_section_progress (user_id, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_year_status_active
  ON enrollments (ecclesiastical_year_id, investiture_status, active);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_club_enrollments_year_status
  ON club_enrollments (ecclesiastical_year_id, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_club_role_assignments_year_active_status
  ON club_role_assignments (ecclesiastical_year_id, active, status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_annual_folders_status
  ON annual_folders (status);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_monthly_reports_submitter_submitted
  ON monthly_reports (submitted_by, submitted_at);

-- ============================================================
-- Ownership / evidence FK lookups
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_emergency_contacts_owner_active
  ON emergency_contacts (owner_id, active);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_evidence_files_purchase
  ON insurance_evidence_files (insurance_purchase_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_evidence_files_assignment
  ON insurance_evidence_files (insurance_assignment_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_insurance_evidence_files_uploaded_by
  ON insurance_evidence_files (uploaded_by_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accounts_user_id
  ON accounts (user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finances_finance_date
  ON finances (finance_date);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_resources_created_at
  ON resources (created_at DESC);

-- ============================================================
-- ILIKE / contains search (pg_trgm)
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_resources_title_trgm
  ON resources USING gin (title gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_finances_description_trgm
  ON finances USING gin (description gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_reports_title_trgm
  ON support_reports USING gin (title gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_reports_description_trgm
  ON support_reports USING gin (description gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_material_products_sku_trgm
  ON material_products USING gin (sku gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_material_products_title_trgm
  ON material_products USING gin (title gin_trgm_ops);

-- ============================================================
-- Pass 2: remaining hot filters found in second review
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_enrollments_status_submitted_active
  ON enrollments (investiture_status, submitted_at)
  WHERE active = true AND submitted_at IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_weekly_records_user_year_week_active
  ON weekly_records (user_id, year, week)
  WHERE active = true;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folders_ecclesiastical_year
  ON folders (ecclesiastical_year_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_union_camporee_lfs_field_active
  ON union_camporee_local_fields (local_field_id, active);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_annual_folders_status_modified
  ON annual_folders (status, modified_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_folder_templates_name_trgm
  ON folder_templates USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_camporee_events_title_trgm
  ON camporee_events USING gin (title gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_camporee_events_local_day_start
  ON camporee_events (local_camporee_id, day_number, starts_at, display_order);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_camporee_events_union_day_start
  ON camporee_events (union_camporee_id, day_number, starts_at, display_order);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_churches_district_name
  ON churches (districlub_type_id, name);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_honors_name
  ON honors (name);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_club_sections_club_active
  ON club_sections (main_club_id, active);
