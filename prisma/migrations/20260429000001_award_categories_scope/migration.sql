-- 20260429000001_award_categories_scope
-- Spec §4.4 — extiende award_categories con polimorfismo de scope

ALTER TABLE award_categories
  ADD COLUMN scope VARCHAR(20) NOT NULL DEFAULT 'club';

ALTER TABLE award_categories
  ADD CONSTRAINT chk_award_scope
  CHECK (scope IN ('club', 'section', 'member'));

UPDATE award_categories SET scope = 'club' WHERE scope IS NULL;

CREATE INDEX idx_award_categories_scope
  ON award_categories(scope, is_legacy);
