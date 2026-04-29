-- 20260429000000_enrollment_rankings_schema
-- Audit reference: docs/superpowers/audits/2026-04-29-section-member-schema-audit.md (A1, A3, A10)
-- 3 tablas nuevas + indexes + CHECK constraints

CREATE TABLE enrollment_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id INTEGER NOT NULL REFERENCES enrollments(enrollment_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(user_id),
  club_id INTEGER NOT NULL REFERENCES clubs(club_id),
  club_section_id INTEGER REFERENCES club_sections(club_section_id),
  ecclesiastical_year_id INTEGER NOT NULL REFERENCES ecclesiastical_years(year_id),
  class_score_pct NUMERIC(5,2),
  investiture_score_pct NUMERIC(5,2),
  camporee_score_pct NUMERIC(5,2),
  composite_score_pct NUMERIC(5,2),
  rank_position INTEGER,
  awarded_category_id UUID REFERENCES award_categories(award_category_id),
  composite_calculated_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_enrollment_rankings_enrollment_year
    UNIQUE (enrollment_id, ecclesiastical_year_id),
  CONSTRAINT chk_enrollment_rankings_class_score
    CHECK (class_score_pct IS NULL OR (class_score_pct BETWEEN 0 AND 100)),
  CONSTRAINT chk_enrollment_rankings_invest_score
    CHECK (investiture_score_pct IS NULL OR (investiture_score_pct BETWEEN 0 AND 100)),
  CONSTRAINT chk_enrollment_rankings_camporee_score
    CHECK (camporee_score_pct IS NULL OR (camporee_score_pct BETWEEN 0 AND 100)),
  CONSTRAINT chk_enrollment_rankings_composite
    CHECK (composite_score_pct IS NULL OR (composite_score_pct BETWEEN 0 AND 100))
);

CREATE INDEX idx_enrollment_rankings_club_year
  ON enrollment_rankings(club_id, ecclesiastical_year_id);

CREATE INDEX idx_enrollment_rankings_section_year
  ON enrollment_rankings(club_section_id, ecclesiastical_year_id);

CREATE INDEX idx_enrollment_rankings_composite
  ON enrollment_rankings(club_id, ecclesiastical_year_id, composite_score_pct DESC NULLS LAST);

CREATE INDEX idx_enrollment_rankings_user
  ON enrollment_rankings(user_id);

CREATE TABLE section_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_section_id INTEGER NOT NULL REFERENCES club_sections(club_section_id) ON DELETE CASCADE,
  club_id INTEGER NOT NULL REFERENCES clubs(club_id),
  ecclesiastical_year_id INTEGER NOT NULL REFERENCES ecclesiastical_years(year_id),
  composite_score_pct NUMERIC(5,2),
  active_enrollment_count INTEGER NOT NULL DEFAULT 0,
  rank_position INTEGER,
  awarded_category_id UUID REFERENCES award_categories(award_category_id),
  composite_calculated_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT uq_section_rankings_section_year
    UNIQUE (club_section_id, ecclesiastical_year_id),
  CONSTRAINT chk_section_rankings_composite
    CHECK (composite_score_pct IS NULL OR (composite_score_pct BETWEEN 0 AND 100)),
  CONSTRAINT chk_section_rankings_count_nonneg
    CHECK (active_enrollment_count >= 0)
);

CREATE INDEX idx_section_rankings_club_year
  ON section_rankings(club_id, ecclesiastical_year_id);

CREATE INDEX idx_section_rankings_composite
  ON section_rankings(club_id, ecclesiastical_year_id, composite_score_pct DESC NULLS LAST);

CREATE TABLE enrollment_ranking_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_type_id INTEGER REFERENCES club_types(club_type_id),
  ecclesiastical_year_id INTEGER REFERENCES ecclesiastical_years(year_id),
  class_pct NUMERIC(5,2) NOT NULL,
  investiture_pct NUMERIC(5,2) NOT NULL,
  camporee_pct NUMERIC(5,2) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT chk_enrollment_weights_sum_100
    CHECK (class_pct + investiture_pct + camporee_pct = 100),
  CONSTRAINT chk_enrollment_weights_class_range
    CHECK (class_pct BETWEEN 0 AND 100),
  CONSTRAINT chk_enrollment_weights_invest_range
    CHECK (investiture_pct BETWEEN 0 AND 100),
  CONSTRAINT chk_enrollment_weights_camporee_range
    CHECK (camporee_pct BETWEEN 0 AND 100),
  CONSTRAINT uq_enrollment_weights_type_year
    UNIQUE (club_type_id, ecclesiastical_year_id)
);

CREATE UNIQUE INDEX idx_enrollment_weights_default_global
  ON enrollment_ranking_weights ((club_type_id IS NULL), (ecclesiastical_year_id IS NULL))
  WHERE club_type_id IS NULL AND ecclesiastical_year_id IS NULL;
