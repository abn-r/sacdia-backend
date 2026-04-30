-- 20260429000003_enrollment_rankings_default_award_seeds
-- Cutoffs §11.5 spec — laxos vs club (AAA ≥85 en lugar de ≥80)
-- Adjustments vs spec: removed `color` column (not in award_categories); changed `updated_at` → `modified_at`

INSERT INTO award_categories
  (award_category_id, name, scope, min_composite_pct, max_composite_pct, is_legacy, created_at, modified_at)
VALUES
  (gen_random_uuid(), 'AAA', 'member',  85, 100,   false, NOW(), NOW()),
  (gen_random_uuid(), 'AA',  'member',  75, 84.99, false, NOW(), NOW()),
  (gen_random_uuid(), 'A',   'member',  65, 74.99, false, NOW(), NOW()),
  (gen_random_uuid(), 'B',   'member',  50, 64.99, false, NOW(), NOW()),
  (gen_random_uuid(), 'C',   'member',  0,  49.99, false, NOW(), NOW()),
  (gen_random_uuid(), 'AAA', 'section', 85, 100,   false, NOW(), NOW()),
  (gen_random_uuid(), 'AA',  'section', 75, 84.99, false, NOW(), NOW()),
  (gen_random_uuid(), 'A',   'section', 65, 74.99, false, NOW(), NOW()),
  (gen_random_uuid(), 'B',   'section', 50, 64.99, false, NOW(), NOW()),
  (gen_random_uuid(), 'C',   'section', 0,  49.99, false, NOW(), NOW())
ON CONFLICT DO NOTHING;
