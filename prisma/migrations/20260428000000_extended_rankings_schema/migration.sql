-- Migration: extended_rankings_schema
-- Created: 2026-04-28
-- Description: Extended rankings schema: add component + composite score columns to club_annual_rankings, add composite_pct thresholds + is_legacy flag to award_categories, mark pre-existing categories as legacy.
-- NOTE: Apply manually via psql — Neon shadow DB is disabled.
ALTER TABLE club_annual_rankings
  ADD COLUMN folder_score_pct numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN finance_score_pct numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN camporee_score_pct numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN evidence_score_pct numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN composite_score_pct numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN composite_calculated_at timestamptz;

CREATE INDEX idx_rankings_composite
  ON club_annual_rankings (ecclesiastical_year_id, composite_score_pct DESC);

ALTER TABLE award_categories
  ADD COLUMN min_composite_pct numeric(5,2),
  ADD COLUMN max_composite_pct numeric(5,2),
  ADD COLUMN is_legacy boolean NOT NULL DEFAULT false;

UPDATE award_categories SET is_legacy = true WHERE created_at < '2026-04-28';
