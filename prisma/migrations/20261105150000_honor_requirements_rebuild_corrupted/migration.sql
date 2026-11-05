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
-- the texts. Nobody has progress on these honors. Re-running is safe: values
-- are fixed and inserts skip rows that already exist.

-- Free the numbers that move ((honor_id, requirement_number) is unique).
UPDATE honor_requirements SET requirement_number = -requirement_id
WHERE requirement_id IN (
  527, 528, 529, 530, 5761, 5762, 5763, 5764, 5765, 5766, 5767, 5768,
  1649, 6532, 6533, 6534, 6535, 6536, 6537, 6538, 6539, 6540, 6541,
  7849, 7850, 7851, 7852, 7853,
  7858, 7859, 7860, 7861, 7862, 7863, 7864, 7865, 7866, 7867, 7868,
  7871, 7872, 7873, 7874, 7875, 7876, 7877, 7878
) AND requirement_number > 0;

-- ── Aves (honor 460) ────────────────────────────────────────────────────
UPDATE honor_requirements SET requirement_text = 'Dar 2 características que establecen a las aves aparte de todas las demás criaturas.', modified_at = now() WHERE requirement_id = 521;
UPDATE honor_requirements SET requirement_text = 'Nombrar 3 aves no voladoras, decir lo que compone su dieta y el nombre del país o continente en el que cada una vive.', modified_at = now() WHERE requirement_id = 522;
UPDATE honor_requirements SET requirement_text = 'Mencionar el día de la semana cuando las aves fueron creadas. Buscar en la Biblia los nombres de 5 aves y poder nombrarlas de memoria.', modified_at = now() WHERE requirement_id = 523;
UPDATE honor_requirements SET requirement_text = 'Escribir o dar verbalmente 3 maneras en que el amor y el propósito de Dios se muestra en la creación de las aves.', modified_at = now() WHERE requirement_id = 524;
UPDATE honor_requirements SET requirement_text = 'Hacer una lista de 30 especies de aves silvestres, incluyendo las aves de al menos 5 diferentes órdenes, que personalmente ha observado y positivamente identificado por vista al aire libre.', modified_at = now() WHERE requirement_id = 525;
UPDATE honor_requirements SET requirement_text = 'Hacer una lista de 5 especies de aves silvestres que personalmente ha identificado positivamente escuchando el sonido al aire libre.', has_sub_items = false, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 526;
UPDATE honor_requirements SET active = false, modified_at = now() WHERE requirement_id IN (527, 528, 529);
UPDATE honor_requirements SET requirement_number = 7, display_label = '7', requirement_text = 'Realizar una de las siguientes actividades:', has_sub_items = true, is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = 530;
UPDATE honor_requirements SET parent_id = 530, requirement_number = 7001, modified_at = now() WHERE requirement_id = 5761;
UPDATE honor_requirements SET parent_id = 530, requirement_number = 7002, requirement_text = 'Encontrar un nido de aves durante la temporada de anidación, identificar la especie de ave que lo construyó, describir el nido en detalle, observar el nido durante 5 días e informar lo que sucedió en el nido en cada uno de los días.', modified_at = now() WHERE requirement_id = 5762;
UPDATE honor_requirements SET parent_id = 530, requirement_number = 7003, has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 5763;
UPDATE honor_requirements SET parent_id = 530, requirement_number = 7004, modified_at = now() WHERE requirement_id = 5768;
UPDATE honor_requirements SET parent_id = 5763, requirement_number = 7300 + (requirement_id - 5763), modified_at = now() WHERE requirement_id IN (5764, 5765, 5766, 5767);

-- ── Deportes Adaptados (honor 45) ───────────────────────────────────────
UPDATE honor_requirements SET requirement_text = 'Nombrar por lo menos 10 modalidades de deportes adaptados.', modified_at = now() WHERE requirement_id = 1646;
UPDATE honor_requirements SET requirement_text = 'Nombrar por lo menos 2 competencias internacionales para los deportes adaptados.', modified_at = now() WHERE requirement_id = 1647;
INSERT INTO honor_requirements (honor_id, requirement_number, display_label, requirement_text)
SELECT 45, 6, '6', 'Entrevistar a una persona con discapacidad y preguntarle si practica algún deporte.'
WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 45 AND requirement_number = 6);
UPDATE honor_requirements SET requirement_text = 'Hacer uno de lo siguiente:', has_sub_items = true, is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = 1648;
UPDATE honor_requirements SET parent_id = 1648, requirement_number = 7001, has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 6532;
UPDATE honor_requirements SET parent_id = 6532, requirement_number = 7100 + (requirement_id - 6532), modified_at = now() WHERE requirement_id IN (6533, 6534, 6535, 6536);
UPDATE honor_requirements SET parent_id = 1648, requirement_number = 7002, requirement_text = 'Asistir a un evento de deporte colectivo realizado por personas con discapacidad y presentar un informe de esta experiencia.', modified_at = now() WHERE requirement_id = 6537;
INSERT INTO honor_requirements (honor_id, requirement_number, display_label, requirement_text, has_sub_items, is_choice_group, choice_min)
SELECT 45, 8, '8', 'Hacer una investigación sobre los Juegos Paraolímpicos. Incluir información sobre la historia y la importancia del evento para las personas con discapacidad. Incluir en sus hallazgos información específica como quién asiste, cuáles deportes están involucrados, dónde y cuándo los primeros juegos se celebraron, dónde y cuándo los últimos juegos se celebraron, dónde y cuándo serán los próximos juegos, un atleta inspirador de los Juegos Paraolímpicos, junto con cualquiera otra información interesante. Compartir sus hallazgos por medio de:', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 45 AND requirement_number = 8);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text)
SELECT 45, p.requirement_id, v.n, v.l, v.t
FROM (SELECT requirement_id FROM honor_requirements WHERE honor_id = 45 AND requirement_number = 8) p,
     (VALUES (8001, 'a', 'Un informe escrito de por lo menos 500 palabras'),
             (8002, 'b', 'Una presentación oral de 3 a 5 minutos usando imágenes o un programa de presentaciones, si es posible')) AS v(n, l, t)
WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 45 AND requirement_number = v.n);
UPDATE honor_requirements SET parent_id = (SELECT requirement_id FROM honor_requirements WHERE honor_id = 45 AND requirement_number = 8), requirement_number = 8003, requirement_text = 'Una exhibición o cartel detallado que incluye imágenes y descripciones', modified_at = now() WHERE requirement_id = 6538;
UPDATE honor_requirements SET requirement_number = 10, display_label = '10', requirement_text = 'Descubrir y discutir 2 milagros realizados por personas con discapacidad en la Biblia. Incluir en su discusión:', has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 1649;
INSERT INTO honor_requirements (honor_id, requirement_number, display_label, requirement_text)
SELECT 45, 9, '9', 'Discutir o compartir qué haría si en su club entrase un Conquistador con discapacidad y quisiera practicar algún deporte con su unidad. Evaluar si el lugar de reunión es aún accesible por las personas con discapacidad. Determinar formas específicas en que una persona con discapacidad podría sentirse integrado en su unidad o club y sus actividades.'
WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 45 AND requirement_number = 9);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text)
SELECT 45, 1649, v.n, v.l, v.t
FROM (VALUES (10001, 'a', '¿Qué discapacidad tenía el individuo? ¿Qué se llamaría esta discapacidad hoy en día?'),
             (10002, 'b', '¿Cómo la discapacidad había afectado a la vida de la persona?'),
             (10003, 'c', '¿Cómo fue la persona sanada?')) AS v(n, l, t)
WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 45 AND requirement_number = v.n);
UPDATE honor_requirements SET parent_id = 1649, requirement_number = 10004 + (requirement_id - 6539), modified_at = now() WHERE requirement_id IN (6539, 6540, 6541);

-- ── Memorizar la Biblia (honor 412) ─────────────────────────────────────
UPDATE honor_requirements SET requirement_text = 'Conocer 4 atajos de métodos de memorización.', modified_at = now() WHERE requirement_id = 3317;
UPDATE honor_requirements SET requirement_text = 'Conocer un método ingenioso para «calentar» la mente (como el método «Sparky» [chispeante]).', has_sub_items = false, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 3318;
INSERT INTO honor_requirements (honor_id, requirement_number, display_label, requirement_text, has_sub_items, is_choice_group, choice_min)
SELECT 412, 4, '4', 'Utilizando sus habilidades y su conocimiento de cómo las personas memorizan, explorar una de las siguientes aventuras con las Escrituras:', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 412 AND requirement_number = 4);
UPDATE honor_requirements SET parent_id = (SELECT requirement_id FROM honor_requirements WHERE honor_id = 412 AND requirement_number = 4), requirement_number = 4000 + (requirement_id - 7849) / 4 + 1, has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id IN (7849, 7853);
UPDATE honor_requirements SET parent_id = 7849, requirement_number = 4100 + (requirement_id - 7849), modified_at = now() WHERE requirement_id IN (7850, 7851, 7852);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text)
SELECT 412, 7853, v.n, v.l, v.t
FROM (VALUES (4201, 'i', 'Leer en voz alta la historia de Mateo 14:13-33.'),
             (4202, 'ii', 'En sus propias palabras, preparar una introducción breve de la historia principal. Referirse a Mateo 14:13-21.'),
             (4203, 'iii', 'Memorizar la parte principal de la historia en Mateo 14:22-33.')) AS v(n, l, t)
WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 412 AND requirement_number = v.n);
UPDATE honor_requirements SET requirement_text = 'Como una Biblia Viva, compartir su Aventura con las Escrituras por lo menos 2 veces. Un compartir tiene que ser hecho por usted solo. Incluir la introducción y «animar» la parte principal de la historia. Pista: puede ser creativo y utilizar la tecnología moderna, como videos, etc. Llenar su Registro de Compartir de Biblia Viva, que requiere la firma de un escuchante adulto.', modified_at = now() WHERE requirement_id = 3319;
UPDATE honor_requirements SET requirement_text = 'Hacer una lista de 3 efectos posibles de un joven cristiano memorizando la Palabra de Dios y convirtiéndose en una Biblia Viva.', modified_at = now() WHERE requirement_id = 3320;

-- ── Mensajera de Dios (honor 413) ───────────────────────────────────────
UPDATE honor_requirements SET requirement_text = 'Demostrar conocimiento de lo siguiente. Esto se hace mejor como grupo y lo más probable involucrará estudio y trabajo en grupo. Adicionalmente, proyectos creativos como carteles, exhibiciones, presentaciones y juegos de mesa pueden ser maneras de presentar su conocimiento.', has_sub_items = true, modified_at = now() WHERE requirement_id = 3322;
UPDATE honor_requirements SET requirement_text = 'Los hechos básicos de la vida de Elena G. de White incluyendo eventos como:', has_sub_items = true, modified_at = now() WHERE requirement_id = 7857;
UPDATE honor_requirements SET parent_id = 7857, requirement_number = 1100 + (requirement_id - 7858), modified_at = now() WHERE requirement_id BETWEEN 7859 AND 7868;
UPDATE honor_requirements SET active = false, modified_at = now() WHERE requirement_id = 7858;
UPDATE honor_requirements SET has_sub_items = true, modified_at = now() WHERE requirement_id IN (7869, 7870);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text)
SELECT 413, v.p, v.n, v.l, v.t
FROM (VALUES (7869, 1201, 'i', 'Ambiente espiritual: segundo gran despertar / millerismo / Gran Chasco'),
             (7869, 1202, 'ii', 'Ambiente social'),
             (7869, 1203, 'iii', 'Ambiente político'),
             (7870, 1301, 'i', 'Libros escritos directamente por Elena de White'),
             (7870, 1302, 'ii', 'Libros escritos/compilados por Elena de White de artículos, panfletos o cartas'),
             (7870, 1303, 'iii', 'Artículos de publicaciones.'),
             (7870, 1304, 'iv', 'Cartas y otros manuscritos'),
             (7870, 1305, 'v', 'Compilaciones por el Patrimonio White (de los escritos de Elena de White): libros devocionales')) AS v(p, n, l, t)
WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 413 AND requirement_number = v.n);
UPDATE honor_requirements SET parent_id = 7870, requirement_number = 1306, modified_at = now() WHERE requirement_id = 7871;
UPDATE honor_requirements SET parent_id = 3322, requirement_number = 1004, has_sub_items = true, modified_at = now() WHERE requirement_id = 7872;
UPDATE honor_requirements SET parent_id = 7872, requirement_number = 1401, requirement_text = '¿Cómo se determina lo que es considerado como escritos inspirados? Textos: 2 Timoteo 3:16 y 17; 2 Pedro 1: 20 y 21', modified_at = now() WHERE requirement_id = 7873;
UPDATE honor_requirements SET parent_id = 7872, requirement_number = 1400 + (requirement_id - 7872), modified_at = now() WHERE requirement_id IN (7874, 7875);
UPDATE honor_requirements SET parent_id = 3322, requirement_number = 1005, has_sub_items = true, modified_at = now() WHERE requirement_id = 7876;
UPDATE honor_requirements SET parent_id = 7876, requirement_number = 1504, modified_at = now() WHERE requirement_id = 7877;
UPDATE honor_requirements SET parent_id = 3322, requirement_number = 1006, has_sub_items = true, modified_at = now() WHERE requirement_id = 7878;
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text)
SELECT 413, v.p, v.n, v.l, v.t
FROM (VALUES (7876, 1501, 'i', 'Isaías 8:20 (Deuteronomio 13:1-4; 2 Crónicas 24:19 y 20; 1 Juan 4:2 y 3)'),
             (7876, 1502, 'ii', 'Jeremías 28:9 / Deuteronomio 18:22'),
             (7876, 1503, 'iii', 'Juan 4:22'),
             (7878, 1601, 'i', '¿Cuáles son algunas de las maneras que Elena de White cumple las pruebas bíblicas de un profeta?'),
             (7878, 1602, 'ii', '¿Qué cree la Iglesia Adventista de la relación entre los escritos de Elena de White y la Biblia?')) AS v(p, n, l, t)
WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE honor_id = 413 AND requirement_number = v.n);
UPDATE honor_requirements SET requirement_text = 'Ganar 200 puntos o más en el tiempo designado del juego Pitcairn de la página web http://honor.ellenwhite.org/index.php.', has_sub_items = false, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 3323;
