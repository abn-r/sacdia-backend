-- Migration: 20261014100000_fix_legacy_honors_club_type
-- Corrige el tipo de club del catalogo historico de especialidades.
--
-- Las especialidades heredadas (code 'LEGACY-<honor_id>', honor_id 1..723) son
-- las especialidades JA estandar de Conquistadores / Guias Mayores, pero el
-- seed original dejo honors.club_type_id = 1 (Aventureros) en 637 de ellas,
-- 2 en 55 y 3 en una (649 "Bioseguridad"). La migracion
-- 20260612000000_honor_applicability_and_class_links copio ese valor erroneo a
-- honor_club_types. Ademas, en development alguien puso honors.club_type_id = 2
-- a mano (sin migracion) y no actualizo honor_club_types, asi que ambas tablas
-- quedaron en conflicto.
--
-- Estado objetivo (decidido por producto):
--   * Toda especialidad heredada (code LIKE 'LEGACY-%'): honors.club_type_id = 2
--     (Conquistadores) y exactamente UNA fila ACTIVA en honor_club_types con
--     club_type_id = 2.
--   * Excepcion: LEGACY-649 "Bioseguridad" sigue siendo de Guias Mayores
--     (club_type_id = 3 en ambas tablas). Se protege por code Y por nombre: si
--     la fila 649 no se llama "Bioseguridad" se omite por completo (ni se toca
--     ni falla la migracion).
--   * Las especialidades que NO son heredadas (p. ej. la importacion de
--     Aventureros, code 'ADV-...') no se tocan.
--
-- DELETE vs desactivar: ninguna tabla ni FK referencia honor_club_types (solo
-- ella apunta a honors y club_types; ver schema.prisma), asi que no hay
-- historial que preservar. Las filas sobrantes se BORRAN en lugar de quedar
-- inactivas: asi el catalogo (que filtra por honor_club_types) y
-- assertHonorsMatchActiveClubSection (que lee honors.club_type_id) no pueden
-- volver a discrepar y los conteos de verificacion son exactos.
--
-- Idempotente y segura desde los tres estados de partida (development,
-- staging, production): cada sentencia solo actua sobre filas que difieren del
-- objetivo, asi que re-ejecutarla no cambia nada. No usa CONCURRENTLY ni
-- control de transacciones: sirve para `prisma migrate deploy` y para
-- `psql -v ON_ERROR_STOP=1 -f` (cada sentencia en su propia transaccion).
--
-- Rollback: solo hacia adelante; el estado anterior era incorrecto.

-- ============================================================
-- 0. Precondicion: existen los tipos de club destino
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM club_types WHERE club_type_id = 2)
     OR NOT EXISTS (SELECT 1 FROM club_types WHERE club_type_id = 3) THEN
    RAISE EXCEPTION 'club_types 2 (Conquistadores) y 3 (Guias Mayores) deben existir';
  END IF;
END
$$;

-- ============================================================
-- 1. honors.club_type_id
--    objetivo = 3 para LEGACY-649 "Bioseguridad", 2 para el resto de LEGACY-*,
--    NULL (omitir) si LEGACY-649 no se llama "Bioseguridad".
-- ============================================================
UPDATE honors AS h
SET club_type_id = t.target_club_type_id,
    modified_at = now()
FROM (
  SELECT
    honor_id,
    CASE
      WHEN code = 'LEGACY-649'
        THEN CASE WHEN lower(btrim(name)) = 'bioseguridad' THEN 3 END
      ELSE 2
    END AS target_club_type_id
  FROM honors
  WHERE code LIKE 'LEGACY-%'
) AS t
WHERE h.honor_id = t.honor_id
  AND t.target_club_type_id IS NOT NULL
  AND h.club_type_id IS DISTINCT FROM t.target_club_type_id;

-- ============================================================
-- 2. honor_club_types: fila objetivo activa (upsert)
-- ============================================================
INSERT INTO honor_club_types (honor_id, club_type_id, active, created_at, modified_at)
SELECT t.honor_id, t.target_club_type_id, true, now(), now()
FROM (
  SELECT
    honor_id,
    CASE
      WHEN code = 'LEGACY-649'
        THEN CASE WHEN lower(btrim(name)) = 'bioseguridad' THEN 3 END
      ELSE 2
    END AS target_club_type_id
  FROM honors
  WHERE code LIKE 'LEGACY-%'
) AS t
WHERE t.target_club_type_id IS NOT NULL
ON CONFLICT (honor_id, club_type_id) DO UPDATE
SET active = true,
    modified_at = now()
WHERE honor_club_types.active IS DISTINCT FROM true;

-- ============================================================
-- 3. honor_club_types: quitar las filas que no son el objetivo
-- ============================================================
DELETE FROM honor_club_types AS hct
USING (
  SELECT
    honor_id,
    CASE
      WHEN code = 'LEGACY-649'
        THEN CASE WHEN lower(btrim(name)) = 'bioseguridad' THEN 3 END
      ELSE 2
    END AS target_club_type_id
  FROM honors
  WHERE code LIKE 'LEGACY-%'
) AS t
WHERE hct.honor_id = t.honor_id
  AND t.target_club_type_id IS NOT NULL
  AND hct.club_type_id <> t.target_club_type_id;

-- ============================================================
-- 4. Verificacion: falla la migracion si algo quedo inconsistente
-- ============================================================
DO $$
DECLARE
  mismatched integer;
  wrong_active integer;
BEGIN
  -- honors.club_type_id debe coincidir con su unica fila activa de honor_club_types
  -- (omite LEGACY-649 si no se llama "Bioseguridad").
  SELECT count(*) INTO mismatched
  FROM honors h
  WHERE h.code LIKE 'LEGACY-%'
    AND (h.code <> 'LEGACY-649' OR lower(btrim(h.name)) = 'bioseguridad')
    AND (
      (SELECT count(*) FROM honor_club_types x WHERE x.honor_id = h.honor_id) <> 1
      OR NOT EXISTS (
        SELECT 1 FROM honor_club_types x
        WHERE x.honor_id = h.honor_id
          AND x.club_type_id = h.club_type_id
          AND x.active = true
      )
      OR h.club_type_id <> CASE WHEN h.code = 'LEGACY-649' THEN 3 ELSE 2 END
    );

  IF mismatched > 0 THEN
    RAISE EXCEPTION 'fix_legacy_honors_club_type: % especialidades LEGACY-* sin una unica fila activa de honor_club_types igual a honors.club_type_id', mismatched;
  END IF;

  -- Ninguna LEGACY-* (salvo 649) puede tener club_type_id distinto de 2.
  SELECT count(*) INTO wrong_active
  FROM honors h
  JOIN honor_club_types hct ON hct.honor_id = h.honor_id
  WHERE h.code LIKE 'LEGACY-%'
    AND h.code <> 'LEGACY-649'
    AND (hct.club_type_id <> 2 OR h.club_type_id <> 2);

  IF wrong_active > 0 THEN
    RAISE EXCEPTION 'fix_legacy_honors_club_type: % filas LEGACY-* (excepto 649) con club_type_id distinto de 2', wrong_active;
  END IF;
END
$$;
