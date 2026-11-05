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
-- Idempotent: each row is matched by id and only changed when it still
-- differs from the target.

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
WHERE r.requirement_id = t.requirement_id
  AND (r.is_choice_group IS DISTINCT FROM t.is_choice_group
       OR r.choice_min IS DISTINCT FROM t.choice_min);
