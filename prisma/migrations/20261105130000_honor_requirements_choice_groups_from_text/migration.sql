-- Fixes "choose N" requirements that the honor catalog import captured wrong,
-- found by a read-only audit on 2026-11-05. Each row was checked by hand
-- against its text.
--
-- 1. Impossible groups (choice_min above the number of sub-items):
--    - Telecartofilia - Avanzado, req 6 (5025): "300 tarjetas que contengan
--      una de las 3 alternativas". The 300 counts cards; any one card type
--      qualifies, so it is "choose 1 of 3".
--    - Hormigas, req 8 (2826): "Conocer 10 especies… y nombrar: a, b, c".
--      The 10 counts species; a/b/c are what to name for each, so all three
--      are required: a plain parent.
--
-- 2. Plain parents whose text says "N de las siguientes" but that required
--    ALL their sub-items: they become "choose N" with the N of the text.
--
-- Left out on purpose:
--    - Ensamblaje y Mantenimiento de Computadoras, req 20 (1929): its text
--      asks for all of them; the "2 de las 3" belongs to a sub-item.
--    - Evangelismo Personal, req 3 (2140): its i–x options were flattened
--      next to a/b/c; it needs restructuring, not a number.
--
-- Rows are found by natural key, not by id (see below).

-- Requirement ids differ between databases (the import inserted sub-items
-- in a different order in each Neon branch), so rows are found by their
-- natural key as it was before this migration: honor, parent requirement
-- number, label and, where given, the exact text. The migration aborts if
-- any row is missing or ambiguous.
DROP TABLE IF EXISTS _idmap;
CREATE TEMP TABLE _idmap AS
SELECT k.dev_id, r.requirement_id AS real_id
FROM (VALUES
    (1245, 487, NULL, '10', NULL),
    (1349, 253, NULL, '6', NULL),
    (1797, 497, NULL, '12', NULL),
    (2007, 267, NULL, '4', NULL),
    (2017, 502, NULL, '10', NULL),
    (2308, 507, NULL, '6', NULL),
    (2560, 71, NULL, '4', NULL),
    (2826, 517, NULL, '8', NULL),
    (2982, 523, NULL, '6', NULL),
    (3096, 80, NULL, '2', NULL),
    (3115, 81, NULL, '12', NULL),
    (3129, 83, NULL, '4', NULL),
    (3351, 535, NULL, '9', NULL),
    (3780, 419, NULL, '10', NULL),
    (4083, 101, NULL, '11', NULL),
    (4344, 600, NULL, '5', NULL),
    (4732, 313, NULL, '5', NULL),
    (4893, 571, NULL, '16', NULL),
    (5025, 125, NULL, '6', NULL),
    (5069, 573, NULL, '12', NULL)
) AS k(dev_id, honor_id, parent_number, display_label, text_md5)
LEFT JOIN honor_requirements r
  ON r.honor_id = k.honor_id
 AND r.display_label IS NOT DISTINCT FROM k.display_label
 AND (k.text_md5 IS NULL OR md5(r.requirement_text) = k.text_md5::text)
 AND ((k.parent_number IS NULL AND r.parent_id IS NULL)
      OR EXISTS (SELECT 1 FROM honor_requirements p
                 WHERE p.requirement_id = r.parent_id
                   AND p.requirement_number = k.parent_number::int));
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM _idmap WHERE real_id IS NULL)
     OR (SELECT count(*) FROM _idmap) <> (SELECT count(DISTINCT dev_id) FROM _idmap) THEN
    RAISE EXCEPTION 'honor requirement id map: missing or ambiguous rows';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.rid(integer) RETURNS integer
LANGUAGE sql STABLE AS $f$ SELECT real_id FROM pg_temp._idmap WHERE dev_id = $1 $f$;

UPDATE honor_requirements AS r
SET is_choice_group = t.is_choice_group,
    choice_min = t.choice_min,
    modified_at = now()
FROM (
  VALUES
    (5025, true, 1),     -- Telecartofilia - Avanzado 6
    (2826, false, NULL), -- Hormigas 8
    (1245, true, 2),     -- Combustibles Alternativos 10 (2 de 4)
    (1349, true, 2),     -- Construcción con LEGO 6 (2 de 5)
    (1797, true, 2),     -- Dunas 12 (2 de 7)
    (2007, true, 4),     -- Esmaltado en Cobre - Avanzado 4 (4 de 5)
    (2017, true, 2),     -- Especies en Peligro de Extinción 10 (2 de 5)
    (2308, true, 3),     -- Flores 6 (3 de 5)
    (2560, true, 6),     -- Gimnasia 4 (6 de 8)
    (2982, true, 2),     -- Invertebrados Marinos 6 (2 de 3)
    (3096, true, 4),     -- Liderazgo al Aire Libre 2 (4 de 7)
    (3115, true, 7),     -- Liderazgo al Aire Libre - Avanzado 12 (7 de 19)
    (3129, true, 2),     -- Liderazgo en la Naturaleza - Avanzado 4 (2 de 6)
    (3351, true, 2),     -- Meteoritos 9 (2 de 4)
    (3780, true, 2),     -- Oración - Avanzado 10 (2 de 6)
    (4083, true, 2),     -- Pionerismo 11 (2 de 7)
    (4344, true, 5),     -- Química 5 (5 de 10)
    (4732, true, 2),     -- Serigrafía - Avanzado 5 (2 de 3)
    (4893, true, 2),     -- Taiga 16 (2 de 8)
    (5069, true, 2)      -- Tiburones 12 (2 de 5)
) AS t(requirement_id, is_choice_group, choice_min)
WHERE r.requirement_id = pg_temp.rid(t.requirement_id)
  AND (r.is_choice_group IS DISTINCT FROM t.is_choice_group
       OR r.choice_min IS DISTINCT FROM t.choice_min);

DROP FUNCTION pg_temp.rid(integer);
DROP TABLE _idmap;
