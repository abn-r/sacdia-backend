-- Guía Mayor is the entry class of Guías Mayores.
-- requires_invested_gm = true created a chicken-and-egg: enrollUser demands an
-- INVESTIDO enrollment in some GM class before allowing the first GM enrollment.
-- Advanced GM classes (Avanzado, Instructor) keep the flag true.

UPDATE "classes"
SET "requires_invested_gm" = false
WHERE "requires_invested_gm" = true
  AND lower("name") IN ('guía mayor', 'guia mayor');
