-- Rebuilds four honors whose requirements the catalog import merged or split
-- (left out of 20261105140000). Each was reconstructed by hand from the text
-- the import kept, on 2026-11-05:
--   * Aves: requirement 5's 30-line answer grid became fake requirements
--     6-9 ("16. 26."), and requirement 10 held the real 6 and 7.
--   * Deportes Adaptados: requirements 5-10 were merged into 9; 5 and 7
--     held only "6." and "8.".
--   * Memorizar la Biblia: requirements 3 and 4 were merged into 3, and
--     option b of the adventure lost its steps.
--   * Mensajera de Dios: requirement 2 held the end of requirement 1 (its
--     options c-f) plus the real requirement 2; option a was split in two.
-- Blank answer lines ("1. 2. 3.") and PDF running headers are dropped from
-- the texts. Nobody has progress on these honors. Rows are found by natural key (see below), not by id.

-- Requirement ids differ between databases (the import inserted sub-items
-- in a different order in each Neon branch), so rows are found by their
-- natural key as it was before this migration: honor, parent requirement
-- number, label and, where given, the exact text. The migration aborts if
-- any row is missing or ambiguous.
DROP TABLE IF EXISTS _idmap;
CREATE TEMP TABLE _idmap AS
SELECT k.dev_id, r.requirement_id AS real_id
FROM (VALUES
    (521, 460, NULL, '1', NULL),
    (522, 460, NULL, '2', NULL),
    (523, 460, NULL, '3', NULL),
    (524, 460, NULL, '4', NULL),
    (525, 460, NULL, '5', NULL),
    (526, 460, NULL, '6', NULL),
    (527, 460, NULL, '7', NULL),
    (528, 460, NULL, '8', NULL),
    (529, 460, NULL, '9', NULL),
    (530, 460, NULL, '10', NULL),
    (1646, 45, NULL, '4', NULL),
    (1647, 45, NULL, '5', NULL),
    (1648, 45, NULL, '7', NULL),
    (1649, 45, NULL, '9', NULL),
    (3317, 412, NULL, '2', NULL),
    (3318, 412, NULL, '3', NULL),
    (3319, 412, NULL, '5', NULL),
    (3320, 412, NULL, '6', NULL),
    (3322, 413, NULL, '1', NULL),
    (3323, 413, NULL, '2', NULL),
    (5761, 460, 10, 'a', NULL),
    (5762, 460, 10, 'b', NULL),
    (5763, 460, 10, 'c', NULL),
    (5764, 460, 10, 'i', NULL),
    (5765, 460, 10, 'ii', NULL),
    (5766, 460, 10, 'iii', NULL),
    (5767, 460, 10, 'iv', NULL),
    (5768, 460, 10, 'd', NULL),
    (6532, 45, 9, 'a', NULL),
    (6533, 45, 9, 'i', NULL),
    (6534, 45, 9, 'ii', NULL),
    (6535, 45, 9, 'iii', NULL),
    (6536, 45, 9, 'iv', NULL),
    (6537, 45, 9, 'b', NULL),
    (6538, 45, 9, 'c', NULL),
    (6539, 45, 9, 'd', NULL),
    (6540, 45, 9, 'e', NULL),
    (6541, 45, 9, 'f', NULL),
    (7849, 412, 3, 'a', NULL),
    (7850, 412, 3, 'i', NULL),
    (7851, 412, 3, 'ii', NULL),
    (7852, 412, 3, 'iii', NULL),
    (7853, 412, 3, 'b', NULL),
    (7857, 413, 1, 'a', NULL),
    (7858, 413, 1, 'g', NULL),
    (7859, 413, 1007, 'i', NULL),
    (7860, 413, 1007, 'ii', NULL),
    (7861, 413, 1007, 'iii', NULL),
    (7862, 413, 1007, 'iv', NULL),
    (7863, 413, 1007, 'v', NULL),
    (7864, 413, 1007, 'vi', NULL),
    (7865, 413, 1007, 'vii', NULL),
    (7866, 413, 1007, 'viii', NULL),
    (7867, 413, 1007, 'ix', NULL),
    (7868, 413, 1007, 'x', NULL),
    (7869, 413, 1, 'b', NULL),
    (7870, 413, 1, 'c', NULL),
    (7871, 413, 2, 'vi', NULL),
    (7872, 413, 2, 'd', NULL),
    (7873, 413, 2, 'i', NULL),
    (7874, 413, 2, 'ii', NULL),
    (7875, 413, 2, 'iii', NULL),
    (7876, 413, 2, 'e', NULL),
    (7877, 413, 2, 'iv', NULL),
    (7878, 413, 2, 'f', NULL)
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

-- Free the numbers that move ((honor_id, requirement_number) is unique).
UPDATE honor_requirements SET requirement_number = -requirement_id
WHERE requirement_id IN (pg_temp.rid(527), pg_temp.rid(528), pg_temp.rid(529), pg_temp.rid(530), pg_temp.rid(5761), pg_temp.rid(5762), pg_temp.rid(5763), pg_temp.rid(5764), pg_temp.rid(5765), pg_temp.rid(5766), pg_temp.rid(5767), pg_temp.rid(5768), pg_temp.rid(1649), pg_temp.rid(6532), pg_temp.rid(6533), pg_temp.rid(6534), pg_temp.rid(6535), pg_temp.rid(6536), pg_temp.rid(6537), pg_temp.rid(6538), pg_temp.rid(6539), pg_temp.rid(6540), pg_temp.rid(6541), pg_temp.rid(7849), pg_temp.rid(7850), pg_temp.rid(7851), pg_temp.rid(7852), pg_temp.rid(7853), pg_temp.rid(7858), pg_temp.rid(7859), pg_temp.rid(7860), pg_temp.rid(7861), pg_temp.rid(7862), pg_temp.rid(7863), pg_temp.rid(7864), pg_temp.rid(7865), pg_temp.rid(7866), pg_temp.rid(7867), pg_temp.rid(7868), pg_temp.rid(7871), pg_temp.rid(7872), pg_temp.rid(7873), pg_temp.rid(7874), pg_temp.rid(7875), pg_temp.rid(7876), pg_temp.rid(7877), pg_temp.rid(7878));

-- ── Aves (honor 460) ────────────────────────────────────────────────────
UPDATE honor_requirements SET requirement_text = 'Dar 2 características que establecen a las aves aparte de todas las demás criaturas.', modified_at = now() WHERE requirement_id = pg_temp.rid(521);
UPDATE honor_requirements SET requirement_text = 'Nombrar 3 aves no voladoras, decir lo que compone su dieta y el nombre del país o continente en el que cada una vive.', modified_at = now() WHERE requirement_id = pg_temp.rid(522);
UPDATE honor_requirements SET requirement_text = 'Mencionar el día de la semana cuando las aves fueron creadas. Buscar en la Biblia los nombres de 5 aves y poder nombrarlas de memoria.', modified_at = now() WHERE requirement_id = pg_temp.rid(523);
UPDATE honor_requirements SET requirement_text = 'Escribir o dar verbalmente 3 maneras en que el amor y el propósito de Dios se muestra en la creación de las aves.', modified_at = now() WHERE requirement_id = pg_temp.rid(524);
UPDATE honor_requirements SET requirement_text = 'Hacer una lista de 30 especies de aves silvestres, incluyendo las aves de al menos 5 diferentes órdenes, que personalmente ha observado y positivamente identificado por vista al aire libre.', modified_at = now() WHERE requirement_id = pg_temp.rid(525);
UPDATE honor_requirements SET requirement_text = 'Hacer una lista de 5 especies de aves silvestres que personalmente ha identificado positivamente escuchando el sonido al aire libre.', has_sub_items = false, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(526);
UPDATE honor_requirements SET active = false, modified_at = now() WHERE requirement_id IN (pg_temp.rid(527), pg_temp.rid(528), pg_temp.rid(529));
UPDATE honor_requirements SET requirement_number = 7, display_label = '7', requirement_text = 'Realizar una de las siguientes actividades:', has_sub_items = true, is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = pg_temp.rid(530);
UPDATE honor_requirements SET parent_id = pg_temp.rid(530), requirement_number = 7001, modified_at = now() WHERE requirement_id = pg_temp.rid(5761);
UPDATE honor_requirements SET parent_id = pg_temp.rid(530), requirement_number = 7002, requirement_text = 'Encontrar un nido de aves durante la temporada de anidación, identificar la especie de ave que lo construyó, describir el nido en detalle, observar el nido durante 5 días e informar lo que sucedió en el nido en cada uno de los días.', modified_at = now() WHERE requirement_id = pg_temp.rid(5762);
UPDATE honor_requirements SET parent_id = pg_temp.rid(530), requirement_number = 7003, has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(5763);
UPDATE honor_requirements SET parent_id = pg_temp.rid(530), requirement_number = 7004, modified_at = now() WHERE requirement_id = pg_temp.rid(5768);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5763), requirement_number = 7301, modified_at = now() WHERE requirement_id = pg_temp.rid(5764);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5763), requirement_number = 7302, modified_at = now() WHERE requirement_id = pg_temp.rid(5765);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5763), requirement_number = 7303, modified_at = now() WHERE requirement_id = pg_temp.rid(5766);
UPDATE honor_requirements SET parent_id = pg_temp.rid(5763), requirement_number = 7304, modified_at = now() WHERE requirement_id = pg_temp.rid(5767);

-- ── Deportes Adaptados (honor 45) ───────────────────────────────────────
UPDATE honor_requirements SET requirement_text = 'Nombrar por lo menos 10 modalidades de deportes adaptados.', modified_at = now() WHERE requirement_id = pg_temp.rid(1646);
UPDATE honor_requirements SET requirement_text = 'Nombrar por lo menos 2 competencias internacionales para los deportes adaptados.', modified_at = now() WHERE requirement_id = pg_temp.rid(1647);
INSERT INTO honor_requirements (honor_id, requirement_number, display_label, requirement_text)
SELECT 45, 6, '6', 'Entrevistar a una persona con discapacidad y preguntarle si practica algún deporte.'
WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 45 AND requirement_number = 6);
UPDATE honor_requirements SET requirement_text = 'Hacer uno de lo siguiente:', has_sub_items = true, is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = pg_temp.rid(1648);
UPDATE honor_requirements SET parent_id = pg_temp.rid(1648), requirement_number = 7001, has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(6532);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6532), requirement_number = 7101, modified_at = now() WHERE requirement_id = pg_temp.rid(6533);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6532), requirement_number = 7102, modified_at = now() WHERE requirement_id = pg_temp.rid(6534);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6532), requirement_number = 7103, modified_at = now() WHERE requirement_id = pg_temp.rid(6535);
UPDATE honor_requirements SET parent_id = pg_temp.rid(6532), requirement_number = 7104, modified_at = now() WHERE requirement_id = pg_temp.rid(6536);
UPDATE honor_requirements SET parent_id = pg_temp.rid(1648), requirement_number = 7002, requirement_text = 'Asistir a un evento de deporte colectivo realizado por personas con discapacidad y presentar un informe de esta experiencia.', modified_at = now() WHERE requirement_id = pg_temp.rid(6537);
INSERT INTO honor_requirements (honor_id, requirement_number, display_label, requirement_text, has_sub_items, is_choice_group, choice_min)
SELECT 45, 8, '8', 'Hacer una investigación sobre los Juegos Paraolímpicos. Incluir información sobre la historia y la importancia del evento para las personas con discapacidad. Incluir en sus hallazgos información específica como quién asiste, cuáles deportes están involucrados, dónde y cuándo los primeros juegos se celebraron, dónde y cuándo los últimos juegos se celebraron, dónde y cuándo serán los próximos juegos, un atleta inspirador de los Juegos Paraolímpicos, junto con cualquiera otra información interesante. Compartir sus hallazgos por medio de:', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 45 AND requirement_number = 8);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text)
SELECT 45, p.requirement_id, v.n, v.l, v.t
FROM (SELECT requirement_id FROM honor_requirements WHERE honor_id = 45 AND requirement_number = 8) p,
     (VALUES (8001, 'a', 'Un informe escrito de por lo menos 500 palabras'),
             (8002, 'b', 'Una presentación oral de 3 a 5 minutos usando imágenes o un programa de presentaciones, si es posible')) AS v(n, l, t)
WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 45 AND requirement_number = v.n);
UPDATE honor_requirements SET parent_id = (SELECT requirement_id FROM honor_requirements WHERE honor_id = 45 AND requirement_number = 8), requirement_number = 8003, requirement_text = 'Una exhibición o cartel detallado que incluye imágenes y descripciones', modified_at = now() WHERE requirement_id = pg_temp.rid(6538);
UPDATE honor_requirements SET requirement_number = 10, display_label = '10', requirement_text = 'Descubrir y discutir 2 milagros realizados por personas con discapacidad en la Biblia. Incluir en su discusión:', has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(1649);
INSERT INTO honor_requirements (honor_id, requirement_number, display_label, requirement_text)
SELECT 45, 9, '9', 'Discutir o compartir qué haría si en su club entrase un Conquistador con discapacidad y quisiera practicar algún deporte con su unidad. Evaluar si el lugar de reunión es aún accesible por las personas con discapacidad. Determinar formas específicas en que una persona con discapacidad podría sentirse integrado en su unidad o club y sus actividades.'
WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 45 AND requirement_number = 9);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text)
SELECT 45, pg_temp.rid(1649), v.n, v.l, v.t
FROM (VALUES (10001, 'a', '¿Qué discapacidad tenía el individuo? ¿Qué se llamaría esta discapacidad hoy en día?'),
             (10002, 'b', '¿Cómo la discapacidad había afectado a la vida de la persona?'),
             (10003, 'c', '¿Cómo fue la persona sanada?')) AS v(n, l, t)
WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 45 AND requirement_number = v.n);
UPDATE honor_requirements SET parent_id = pg_temp.rid(1649), requirement_number = 10004, modified_at = now() WHERE requirement_id = pg_temp.rid(6539);
UPDATE honor_requirements SET parent_id = pg_temp.rid(1649), requirement_number = 10005, modified_at = now() WHERE requirement_id = pg_temp.rid(6540);
UPDATE honor_requirements SET parent_id = pg_temp.rid(1649), requirement_number = 10006, modified_at = now() WHERE requirement_id = pg_temp.rid(6541);

-- ── Memorizar la Biblia (honor 412) ─────────────────────────────────────
UPDATE honor_requirements SET requirement_text = 'Conocer 4 atajos de métodos de memorización.', modified_at = now() WHERE requirement_id = pg_temp.rid(3317);
UPDATE honor_requirements SET requirement_text = 'Conocer un método ingenioso para «calentar» la mente (como el método «Sparky» [chispeante]).', has_sub_items = false, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(3318);
INSERT INTO honor_requirements (honor_id, requirement_number, display_label, requirement_text, has_sub_items, is_choice_group, choice_min)
SELECT 412, 4, '4', 'Utilizando sus habilidades y su conocimiento de cómo las personas memorizan, explorar una de las siguientes aventuras con las Escrituras:', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 412 AND requirement_number = 4);
UPDATE honor_requirements SET parent_id = (SELECT requirement_id FROM honor_requirements WHERE honor_id = 412 AND requirement_number = 4), requirement_number = 4001, has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(7849);
UPDATE honor_requirements SET parent_id = (SELECT requirement_id FROM honor_requirements WHERE honor_id = 412 AND requirement_number = 4), requirement_number = 4002, has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(7853);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7849), requirement_number = 4101, modified_at = now() WHERE requirement_id = pg_temp.rid(7850);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7849), requirement_number = 4102, modified_at = now() WHERE requirement_id = pg_temp.rid(7851);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7849), requirement_number = 4103, modified_at = now() WHERE requirement_id = pg_temp.rid(7852);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text)
SELECT 412, pg_temp.rid(7853), v.n, v.l, v.t
FROM (VALUES (4201, 'i', 'Leer en voz alta la historia de Mateo 14:13-33.'),
             (4202, 'ii', 'En sus propias palabras, preparar una introducción breve de la historia principal. Referirse a Mateo 14:13-21.'),
             (4203, 'iii', 'Memorizar la parte principal de la historia en Mateo 14:22-33.')) AS v(n, l, t)
WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 412 AND requirement_number = v.n);
UPDATE honor_requirements SET requirement_text = 'Como una Biblia Viva, compartir su Aventura con las Escrituras por lo menos 2 veces. Un compartir tiene que ser hecho por usted solo. Incluir la introducción y «animar» la parte principal de la historia. Pista: puede ser creativo y utilizar la tecnología moderna, como videos, etc. Llenar su Registro de Compartir de Biblia Viva, que requiere la firma de un escuchante adulto.', modified_at = now() WHERE requirement_id = pg_temp.rid(3319);
UPDATE honor_requirements SET requirement_text = 'Hacer una lista de 3 efectos posibles de un joven cristiano memorizando la Palabra de Dios y convirtiéndose en una Biblia Viva.', modified_at = now() WHERE requirement_id = pg_temp.rid(3320);

-- ── Mensajera de Dios (honor 413) ───────────────────────────────────────
UPDATE honor_requirements SET requirement_text = 'Demostrar conocimiento de lo siguiente. Esto se hace mejor como grupo y lo más probable involucrará estudio y trabajo en grupo. Adicionalmente, proyectos creativos como carteles, exhibiciones, presentaciones y juegos de mesa pueden ser maneras de presentar su conocimiento.', has_sub_items = true, modified_at = now() WHERE requirement_id = pg_temp.rid(3322);
UPDATE honor_requirements SET requirement_text = 'Los hechos básicos de la vida de Elena G. de White incluyendo eventos como:', has_sub_items = true, modified_at = now() WHERE requirement_id = pg_temp.rid(7857);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7857), requirement_number = 1101, modified_at = now() WHERE requirement_id = pg_temp.rid(7859);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7857), requirement_number = 1102, modified_at = now() WHERE requirement_id = pg_temp.rid(7860);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7857), requirement_number = 1103, modified_at = now() WHERE requirement_id = pg_temp.rid(7861);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7857), requirement_number = 1104, modified_at = now() WHERE requirement_id = pg_temp.rid(7862);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7857), requirement_number = 1105, modified_at = now() WHERE requirement_id = pg_temp.rid(7863);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7857), requirement_number = 1106, modified_at = now() WHERE requirement_id = pg_temp.rid(7864);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7857), requirement_number = 1107, modified_at = now() WHERE requirement_id = pg_temp.rid(7865);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7857), requirement_number = 1108, modified_at = now() WHERE requirement_id = pg_temp.rid(7866);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7857), requirement_number = 1109, modified_at = now() WHERE requirement_id = pg_temp.rid(7867);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7857), requirement_number = 1110, modified_at = now() WHERE requirement_id = pg_temp.rid(7868);
UPDATE honor_requirements SET active = false, modified_at = now() WHERE requirement_id = pg_temp.rid(7858);
UPDATE honor_requirements SET has_sub_items = true, modified_at = now() WHERE requirement_id IN (pg_temp.rid(7869), pg_temp.rid(7870));
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text)
SELECT 413, pg_temp.rid(v.p), v.n, v.l, v.t
FROM (VALUES (7869, 1201, 'i', 'Ambiente espiritual: segundo gran despertar / millerismo / Gran Chasco'),
             (7869, 1202, 'ii', 'Ambiente social'),
             (7869, 1203, 'iii', 'Ambiente político'),
             (7870, 1301, 'i', 'Libros escritos directamente por Elena de White'),
             (7870, 1302, 'ii', 'Libros escritos/compilados por Elena de White de artículos, panfletos o cartas'),
             (7870, 1303, 'iii', 'Artículos de publicaciones.'),
             (7870, 1304, 'iv', 'Cartas y otros manuscritos'),
             (7870, 1305, 'v', 'Compilaciones por el Patrimonio White (de los escritos de Elena de White): libros devocionales')) AS v(p, n, l, t)
WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 413 AND requirement_number = v.n);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7870), requirement_number = 1306, modified_at = now() WHERE requirement_id = pg_temp.rid(7871);
UPDATE honor_requirements SET parent_id = pg_temp.rid(3322), requirement_number = 1004, has_sub_items = true, modified_at = now() WHERE requirement_id = pg_temp.rid(7872);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7872), requirement_number = 1401, requirement_text = '¿Cómo se determina lo que es considerado como escritos inspirados? Textos: 2 Timoteo 3:16 y 17; 2 Pedro 1: 20 y 21', modified_at = now() WHERE requirement_id = pg_temp.rid(7873);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7872), requirement_number = 1402, modified_at = now() WHERE requirement_id = pg_temp.rid(7874);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7872), requirement_number = 1403, modified_at = now() WHERE requirement_id = pg_temp.rid(7875);
UPDATE honor_requirements SET parent_id = pg_temp.rid(3322), requirement_number = 1005, has_sub_items = true, modified_at = now() WHERE requirement_id = pg_temp.rid(7876);
UPDATE honor_requirements SET parent_id = pg_temp.rid(7876), requirement_number = 1504, modified_at = now() WHERE requirement_id = pg_temp.rid(7877);
UPDATE honor_requirements SET parent_id = pg_temp.rid(3322), requirement_number = 1006, has_sub_items = true, modified_at = now() WHERE requirement_id = pg_temp.rid(7878);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text)
SELECT 413, pg_temp.rid(v.p), v.n, v.l, v.t
FROM (VALUES (7876, 1501, 'i', 'Isaías 8:20 (Deuteronomio 13:1-4; 2 Crónicas 24:19 y 20; 1 Juan 4:2 y 3)'),
             (7876, 1502, 'ii', 'Jeremías 28:9 / Deuteronomio 18:22'),
             (7876, 1503, 'iii', 'Juan 4:22'),
             (7878, 1601, 'i', '¿Cuáles son algunas de las maneras que Elena de White cumple las pruebas bíblicas de un profeta?'),
             (7878, 1602, 'ii', '¿Qué cree la Iglesia Adventista de la relación entre los escritos de Elena de White y la Biblia?')) AS v(p, n, l, t)
WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 413 AND requirement_number = v.n);
UPDATE honor_requirements SET requirement_text = 'Ganar 200 puntos o más en el tiempo designado del juego Pitcairn de la página web http://honor.ellenwhite.org/index.php.', has_sub_items = false, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = pg_temp.rid(3323);

DROP FUNCTION pg_temp.rid(integer);
DROP TABLE _idmap;
