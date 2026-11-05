-- The honor catalog import stored the roman-numeral options (i, ii, iii…) of a
-- sub-item next to the letters (a, b, c) under the same parent, so a plain
-- parent asked for every option. Where two letters had their own i, ii…,
-- the repeated labels of the second one were dropped.
--
-- For 37 requirements (checked against their text on 2026-11-05):
--   * each roman option moves under its letter, renumbered in text order;
--   * the lost options are added back from the parent's text;
--   * the letter becomes a sub-item parent ("choose 1" when its text says
--     "uno de los siguientes"; otherwise all of them);
--   * the parent becomes "choose N" when its text says "N de las siguientes".
--
-- Left out (their text is corrupted: other requirements are merged into it):
-- Aves 10 (530), Deportes Adaptados 9 (1649), Memorizar la Biblia 3 (3318),
-- Mensajera de Dios 2 (3323).
--
-- Progress is kept: rows only change parent, and nobody has progress on the
-- moved options. Re-running is safe: updates set fixed values and inserts
-- skip options that already exist.

-- Free the requirement numbers first: (honor_id, requirement_number) is
-- unique and the new numbers reuse the old range.
UPDATE honor_requirements SET requirement_number = -requirement_id
WHERE requirement_id IN (5419, 5420, 5421, 5422, 5423, 5525, 5526, 5527, 5528, 5616, 5617, 5618, 5619, 5621, 5622, 5623, 5647, 5648, 5649, 5667, 5668, 5669, 5670, 5771, 5772, 5773, 5774, 5775, 5776, 5898, 5899, 5857, 5858, 5859, 5860, 6023, 6024, 6025, 6026, 6037, 6038, 6152, 6153, 6154, 6155, 6156, 6320, 6321, 6322, 6323, 6330, 6331, 6339, 6340, 6341, 6342, 6343, 6344, 6345, 6346, 6348, 6349, 6591, 6592, 6895, 6896, 6897, 6898, 6899, 6900, 6901, 6903, 6905, 6906, 7137, 7138, 7139, 7419, 7420, 7413, 7414, 7416, 7417, 7405, 7406, 7407, 7408, 7409, 7410, 7488, 7489, 7490, 7491, 7492, 7493, 7494, 7495, 7496, 7497, 7511, 7512, 7513, 7523, 7524, 7525, 7526, 7527, 7528, 7797, 7798, 7799, 7800, 7801, 7802, 7803, 7804, 7832, 7833, 7834, 7835, 7836, 7837, 7838, 7839, 7859, 7860, 7861, 7862, 7863, 7864, 7865, 7866, 7867, 7868, 7929, 7930, 7931, 7932, 7934, 7935, 7936, 7937, 7978, 7979, 7980, 7981, 8029, 8030, 8031, 8032, 8033, 8152, 8153, 8154, 8365, 8366, 8367, 8368, 8369, 8370, 8371, 8394, 8395, 8396, 8471, 8472, 8473, 8474, 8475, 8476, 8570, 8571, 8572, 8573, 8574, 8658, 8659, 8660, 8661, 8664, 8954, 8955, 8956, 8957, 8959, 9042, 9043, 9044, 9047, 9048, 9154, 9155, 9156, 9158, 9159, 9160, 9161, 9162) AND requirement_number > 0;

-- Acuarios · requisito 12 (19)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 5418;
UPDATE honor_requirements SET parent_id = 5418, requirement_number = 12201, modified_at = now() WHERE requirement_id = 5419;
UPDATE honor_requirements SET parent_id = 5418, requirement_number = 12202, modified_at = now() WHERE requirement_id = 5420;
UPDATE honor_requirements SET parent_id = 5418, requirement_number = 12203, modified_at = now() WHERE requirement_id = 5421;
UPDATE honor_requirements SET parent_id = 5418, requirement_number = 12204, modified_at = now() WHERE requirement_id = 5422;
UPDATE honor_requirements SET parent_id = 5418, requirement_number = 12205, modified_at = now() WHERE requirement_id = 5423;

-- Anfibios · requisito 11 (164)
UPDATE honor_requirements SET is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = 164;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 5524;
UPDATE honor_requirements SET parent_id = 5524, requirement_number = 11101, modified_at = now() WHERE requirement_id = 5525;
UPDATE honor_requirements SET parent_id = 5524, requirement_number = 11102, modified_at = now() WHERE requirement_id = 5526;
UPDATE honor_requirements SET parent_id = 5524, requirement_number = 11103, modified_at = now() WHERE requirement_id = 5527;
UPDATE honor_requirements SET parent_id = 5524, requirement_number = 11104, modified_at = now() WHERE requirement_id = 5528;

-- Arqueología bíblica · requisito 11 (305)
UPDATE honor_requirements SET is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = 305;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 5615;
UPDATE honor_requirements SET parent_id = 5615, requirement_number = 11101, modified_at = now() WHERE requirement_id = 5616;
UPDATE honor_requirements SET parent_id = 5615, requirement_number = 11102, modified_at = now() WHERE requirement_id = 5617;
UPDATE honor_requirements SET parent_id = 5615, requirement_number = 11103, modified_at = now() WHERE requirement_id = 5618;
UPDATE honor_requirements SET parent_id = 5615, requirement_number = 11104, modified_at = now() WHERE requirement_id = 5619;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 5620;
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 368, 5620, 11201, 'i', 'Herramientas de recolección' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 5620 AND display_label = 'i' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 368, 5620, 11202, 'ii', 'Colocación de la rejilla/zona de excavación' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 5620 AND display_label = 'ii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 368, 5620, 11203, 'iii', 'Excavación' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 5620 AND display_label = 'iii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 368, 5620, 11204, 'iv', 'Identificación de artefactos' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 5620 AND display_label = 'iv' AND active);
UPDATE honor_requirements SET parent_id = 5620, requirement_number = 11205, modified_at = now() WHERE requirement_id = 5621;
UPDATE honor_requirements SET parent_id = 5620, requirement_number = 11206, modified_at = now() WHERE requirement_id = 5622;
UPDATE honor_requirements SET parent_id = 5620, requirement_number = 11207, modified_at = now() WHERE requirement_id = 5623;

-- Arte Cristiano de Predicar · requisito 4 (325)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 5646;
UPDATE honor_requirements SET parent_id = 5646, requirement_number = 4201, modified_at = now() WHERE requirement_id = 5647;
UPDATE honor_requirements SET parent_id = 5646, requirement_number = 4202, modified_at = now() WHERE requirement_id = 5648;
UPDATE honor_requirements SET parent_id = 5646, requirement_number = 4203, modified_at = now() WHERE requirement_id = 5649;

-- Arte Cristiano de Predicar - Avanzado · requisito 3 (334)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 5666;
UPDATE honor_requirements SET parent_id = 5666, requirement_number = 3301, modified_at = now() WHERE requirement_id = 5667;
UPDATE honor_requirements SET parent_id = 5666, requirement_number = 3302, modified_at = now() WHERE requirement_id = 5668;
UPDATE honor_requirements SET parent_id = 5666, requirement_number = 3303, modified_at = now() WHERE requirement_id = 5669;
UPDATE honor_requirements SET parent_id = 5666, requirement_number = 3304, modified_at = now() WHERE requirement_id = 5670;

-- Aves - Avanzado · requisito 4 (550)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 5770;
UPDATE honor_requirements SET parent_id = 5770, requirement_number = 4201, modified_at = now() WHERE requirement_id = 5771;
UPDATE honor_requirements SET parent_id = 5770, requirement_number = 4202, modified_at = now() WHERE requirement_id = 5772;
UPDATE honor_requirements SET parent_id = 5770, requirement_number = 4203, modified_at = now() WHERE requirement_id = 5773;
UPDATE honor_requirements SET parent_id = 5770, requirement_number = 4204, modified_at = now() WHERE requirement_id = 5774;
UPDATE honor_requirements SET parent_id = 5770, requirement_number = 4205, modified_at = now() WHERE requirement_id = 5775;
UPDATE honor_requirements SET parent_id = 5770, requirement_number = 4206, modified_at = now() WHERE requirement_id = 5776;

-- Aviadores · requisito 7 (593)
UPDATE honor_requirements SET is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = 593;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 5897;
UPDATE honor_requirements SET parent_id = 5897, requirement_number = 7101, modified_at = now() WHERE requirement_id = 5898;
UPDATE honor_requirements SET parent_id = 5897, requirement_number = 7102, modified_at = now() WHERE requirement_id = 5899;

-- Aviadores · requisito 1 (587)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 5856;
UPDATE honor_requirements SET parent_id = 5856, requirement_number = 1101, modified_at = now() WHERE requirement_id = 5857;
UPDATE honor_requirements SET parent_id = 5856, requirement_number = 1102, modified_at = now() WHERE requirement_id = 5858;
UPDATE honor_requirements SET parent_id = 5856, requirement_number = 1103, modified_at = now() WHERE requirement_id = 5859;
UPDATE honor_requirements SET parent_id = 5856, requirement_number = 1104, modified_at = now() WHERE requirement_id = 5860;

-- Camuflaje Animal - Avanzado · requisito 5 (920)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 6022;
UPDATE honor_requirements SET parent_id = 6022, requirement_number = 5101, modified_at = now() WHERE requirement_id = 6023;
UPDATE honor_requirements SET parent_id = 6022, requirement_number = 5102, modified_at = now() WHERE requirement_id = 6024;
UPDATE honor_requirements SET parent_id = 6022, requirement_number = 5103, modified_at = now() WHERE requirement_id = 6025;
UPDATE honor_requirements SET parent_id = 6022, requirement_number = 5104, modified_at = now() WHERE requirement_id = 6026;

-- Canotaje · requisito 2 (923)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 6036;
UPDATE honor_requirements SET parent_id = 6036, requirement_number = 2101, modified_at = now() WHERE requirement_id = 6037;
UPDATE honor_requirements SET parent_id = 6036, requirement_number = 2102, modified_at = now() WHERE requirement_id = 6038;

-- Ciclismo - Avanzado · requisito 7 (1045)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 6151;
UPDATE honor_requirements SET parent_id = 6151, requirement_number = 7101, modified_at = now() WHERE requirement_id = 6152;
UPDATE honor_requirements SET parent_id = 6151, requirement_number = 7102, modified_at = now() WHERE requirement_id = 6153;
UPDATE honor_requirements SET parent_id = 6151, requirement_number = 7103, modified_at = now() WHERE requirement_id = 6154;
UPDATE honor_requirements SET parent_id = 6151, requirement_number = 7104, modified_at = now() WHERE requirement_id = 6155;
UPDATE honor_requirements SET parent_id = 6151, requirement_number = 7105, modified_at = now() WHERE requirement_id = 6156;

-- Computadoras - Avanzado · requisito 5 (1324)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 6319;
UPDATE honor_requirements SET parent_id = 6319, requirement_number = 5101, modified_at = now() WHERE requirement_id = 6320;
UPDATE honor_requirements SET parent_id = 6319, requirement_number = 5102, modified_at = now() WHERE requirement_id = 6321;
UPDATE honor_requirements SET parent_id = 6319, requirement_number = 5103, modified_at = now() WHERE requirement_id = 6322;
UPDATE honor_requirements SET parent_id = 6319, requirement_number = 5104, modified_at = now() WHERE requirement_id = 6323;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 6329;
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 158, 6329, 5701, 'i', 'Poner un marco o hacer borroso los bordes de una fotografía' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6329 AND display_label = 'i' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 158, 6329, 5702, 'ii', 'Cambiar una fotografía digital de color a una de tono sepia o de blanco y negro' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6329 AND display_label = 'ii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 158, 6329, 5703, 'iii', 'Grabar una fotografía digital como una diferente clase de archivo al del original' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6329 AND display_label = 'iii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 158, 6329, 5704, 'iv', 'Combinar elementos de 2 fotografías digitales para crear una tercera imagen.' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6329 AND display_label = 'iv' AND active);
UPDATE honor_requirements SET parent_id = 6329, requirement_number = 5705, modified_at = now() WHERE requirement_id = 6330;
UPDATE honor_requirements SET parent_id = 6329, requirement_number = 5706, modified_at = now() WHERE requirement_id = 6331;

-- Conservación Ambiental · requisito 4 (1330)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 6338;
UPDATE honor_requirements SET parent_id = 6338, requirement_number = 4101, modified_at = now() WHERE requirement_id = 6339;
UPDATE honor_requirements SET parent_id = 6338, requirement_number = 4102, modified_at = now() WHERE requirement_id = 6340;
UPDATE honor_requirements SET parent_id = 6338, requirement_number = 4103, modified_at = now() WHERE requirement_id = 6341;
UPDATE honor_requirements SET parent_id = 6338, requirement_number = 4104, modified_at = now() WHERE requirement_id = 6342;
UPDATE honor_requirements SET parent_id = 6338, requirement_number = 4105, modified_at = now() WHERE requirement_id = 6343;
UPDATE honor_requirements SET parent_id = 6338, requirement_number = 4106, modified_at = now() WHERE requirement_id = 6344;
UPDATE honor_requirements SET parent_id = 6338, requirement_number = 4107, modified_at = now() WHERE requirement_id = 6345;
UPDATE honor_requirements SET parent_id = 6338, requirement_number = 4108, modified_at = now() WHERE requirement_id = 6346;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 6347;
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 489, 6347, 4201, 'i', 'Las grandes masas presentes de algas color azul-verduzco (color verde oscuro)' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6347 AND display_label = 'i' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 489, 6347, 4202, 'ii', 'Bancos de arena raspados por el alto nivel de agua durante las tormentas' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6347 AND display_label = 'ii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 489, 6347, 4203, 'iii', 'Olores putrefactos en el agua' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6347 AND display_label = 'iii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 489, 6347, 4204, 'iv', 'Espuma tipo detergente presente' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6347 AND display_label = 'iv' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 489, 6347, 4205, 'v', 'Basura entre el lodo y los bancos de arena a lo largo del arroyo' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6347 AND display_label = 'v' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 489, 6347, 4206, 'vi', 'El agua cargada de limo' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6347 AND display_label = 'vi' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 489, 6347, 4207, 'vii', 'No hay insectos acuáticos o peces presentes' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6347 AND display_label = 'vii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 489, 6347, 4208, 'viii', 'Presencia de aguas residuales sin tratar' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6347 AND display_label = 'viii' AND active);
UPDATE honor_requirements SET parent_id = 6347, requirement_number = 4209, modified_at = now() WHERE requirement_id = 6348;
UPDATE honor_requirements SET parent_id = 6347, requirement_number = 4210, modified_at = now() WHERE requirement_id = 6349;
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 489, 6347, 4211, 'xi', 'Tiendas o pequeñas fábricas vertiendo sus desechos dentro del arroyo' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6347 AND display_label = 'xi' AND active);

-- Dinosaurios · requisito 6 (1742)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 6590;
UPDATE honor_requirements SET parent_id = 6590, requirement_number = 6301, modified_at = now() WHERE requirement_id = 6591;
UPDATE honor_requirements SET parent_id = 6590, requirement_number = 6302, modified_at = now() WHERE requirement_id = 6592;

-- Evangelismo Personal · requisito 3 (2140)
UPDATE honor_requirements SET is_choice_group = true, choice_min = 2, modified_at = now() WHERE requirement_id = 2140;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = 6894;
UPDATE honor_requirements SET parent_id = 6894, requirement_number = 3101, modified_at = now() WHERE requirement_id = 6895;
UPDATE honor_requirements SET parent_id = 6894, requirement_number = 3102, modified_at = now() WHERE requirement_id = 6896;
UPDATE honor_requirements SET parent_id = 6894, requirement_number = 3103, modified_at = now() WHERE requirement_id = 6897;
UPDATE honor_requirements SET parent_id = 6894, requirement_number = 3104, modified_at = now() WHERE requirement_id = 6898;
UPDATE honor_requirements SET parent_id = 6894, requirement_number = 3105, modified_at = now() WHERE requirement_id = 6899;
UPDATE honor_requirements SET parent_id = 6894, requirement_number = 3106, modified_at = now() WHERE requirement_id = 6900;
UPDATE honor_requirements SET parent_id = 6894, requirement_number = 3107, modified_at = now() WHERE requirement_id = 6901;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = 6902;
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, 6902, 3201, 'i', 'Proyecto de embellecimiento comunitario, como la jardinería o la mejoría de un área pública.' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6902 AND display_label = 'i' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, 6902, 3202, 'ii', 'La hora de la historia' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6902 AND display_label = 'ii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, 6902, 3203, 'iii', 'Ministerio de los payasos' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6902 AND display_label = 'iii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, 6902, 3204, 'iv', 'Ministerio de títeres' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6902 AND display_label = 'iv' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, 6902, 3205, 'v', 'Preparar regalos de Navidad para los niños desfavorecidos' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6902 AND display_label = 'v' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, 6902, 3206, 'vi', 'Alimentos y/o distribución de ropa para los necesitados' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6902 AND display_label = 'vi' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, 6902, 3207, 'vii', 'Programas de visitas a un asilo de ancianos, orfanatos o sala pediátrica de un hospital' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6902 AND display_label = 'vii' AND active);
UPDATE honor_requirements SET parent_id = 6902, requirement_number = 3208, modified_at = now() WHERE requirement_id = 6903;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = 6904;
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, 6904, 3301, 'i', 'Cuidado del patio o el cuidado de la casa de los ancianos' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6904 AND display_label = 'i' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, 6904, 3302, 'ii', 'Enseñar en una división menor del departamento de escuela sabática.' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6904 AND display_label = 'ii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, 6904, 3303, 'iii', 'Charlas de temperancia' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6904 AND display_label = 'iii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, 6904, 3304, 'iv', 'Hacer tutoría a los estudiantes menores' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6904 AND display_label = 'iv' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, 6904, 3305, 'v', 'Trabajo voluntario en un hospital o asilo de ancianos' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6904 AND display_label = 'v' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, 6904, 3306, 'vi', 'Suministrar libros y juegos en un hospital' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6904 AND display_label = 'vi' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, 6904, 3307, 'vii', 'Ayudar a la rehabilitación de una persona con discapacidad física' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6904 AND display_label = 'vii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 394, 6904, 3308, 'viii', 'Hacer carteles y los proyectos para un hospital, asilo de ancianos o un orfanato' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 6904 AND display_label = 'viii' AND active);
UPDATE honor_requirements SET parent_id = 6904, requirement_number = 3309, modified_at = now() WHERE requirement_id = 6905;
UPDATE honor_requirements SET parent_id = 6904, requirement_number = 3310, modified_at = now() WHERE requirement_id = 6906;

-- Gatos - Avanzado · requisito 2 (2479)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 7136;
UPDATE honor_requirements SET parent_id = 7136, requirement_number = 2101, modified_at = now() WHERE requirement_id = 7137;
UPDATE honor_requirements SET parent_id = 7136, requirement_number = 2102, modified_at = now() WHERE requirement_id = 7138;
UPDATE honor_requirements SET parent_id = 7136, requirement_number = 2103, modified_at = now() WHERE requirement_id = 7139;

-- Herrería · requisito 11 (2731)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 7418;
UPDATE honor_requirements SET parent_id = 7418, requirement_number = 11101, modified_at = now() WHERE requirement_id = 7419;
UPDATE honor_requirements SET parent_id = 7418, requirement_number = 11102, modified_at = now() WHERE requirement_id = 7420;

-- Herrería · requisito 8 (2728)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 7412;
UPDATE honor_requirements SET parent_id = 7412, requirement_number = 8101, modified_at = now() WHERE requirement_id = 7413;
UPDATE honor_requirements SET parent_id = 7412, requirement_number = 8102, modified_at = now() WHERE requirement_id = 7414;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 7415;
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 178, 7415, 8201, 'i', 'Peña cruzada' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 7415 AND display_label = 'i' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 178, 7415, 8202, 'ii', 'Peña angulada' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 7415 AND display_label = 'ii' AND active);
UPDATE honor_requirements SET parent_id = 7415, requirement_number = 8203, modified_at = now() WHERE requirement_id = 7416;
UPDATE honor_requirements SET parent_id = 7415, requirement_number = 8204, modified_at = now() WHERE requirement_id = 7417;

-- Herrería · requisito 7 (2727)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 7404;
UPDATE honor_requirements SET parent_id = 7404, requirement_number = 7101, modified_at = now() WHERE requirement_id = 7405;
UPDATE honor_requirements SET parent_id = 7404, requirement_number = 7102, modified_at = now() WHERE requirement_id = 7406;
UPDATE honor_requirements SET parent_id = 7404, requirement_number = 7103, modified_at = now() WHERE requirement_id = 7407;
UPDATE honor_requirements SET parent_id = 7404, requirement_number = 7104, modified_at = now() WHERE requirement_id = 7408;
UPDATE honor_requirements SET parent_id = 7404, requirement_number = 7105, modified_at = now() WHERE requirement_id = 7409;
UPDATE honor_requirements SET parent_id = 7404, requirement_number = 7106, modified_at = now() WHERE requirement_id = 7410;

-- Información Programable · requisito 4 (2882)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 7487;
UPDATE honor_requirements SET parent_id = 7487, requirement_number = 4101, modified_at = now() WHERE requirement_id = 7488;
UPDATE honor_requirements SET parent_id = 7487, requirement_number = 4102, modified_at = now() WHERE requirement_id = 7489;
UPDATE honor_requirements SET parent_id = 7487, requirement_number = 4103, modified_at = now() WHERE requirement_id = 7490;
UPDATE honor_requirements SET parent_id = 7487, requirement_number = 4104, modified_at = now() WHERE requirement_id = 7491;
UPDATE honor_requirements SET parent_id = 7487, requirement_number = 4105, modified_at = now() WHERE requirement_id = 7492;
UPDATE honor_requirements SET parent_id = 7487, requirement_number = 4106, modified_at = now() WHERE requirement_id = 7493;
UPDATE honor_requirements SET parent_id = 7487, requirement_number = 4107, modified_at = now() WHERE requirement_id = 7494;
UPDATE honor_requirements SET parent_id = 7487, requirement_number = 4108, modified_at = now() WHERE requirement_id = 7495;
UPDATE honor_requirements SET parent_id = 7487, requirement_number = 4109, modified_at = now() WHERE requirement_id = 7496;
UPDATE honor_requirements SET parent_id = 7487, requirement_number = 4110, modified_at = now() WHERE requirement_id = 7497;
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 180, 7487, 4111, 'xi', 'Informe del libro de actas y eventos' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 7487 AND display_label = 'xi' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 180, 7487, 4112, 'xii', 'Informe de mensualidades' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 7487 AND display_label = 'xii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 180, 7487, 4113, 'xiii', 'Informe de unidades, clases, especialidades y Conquistadores' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 7487 AND display_label = 'xiii' AND active);

-- Insectos · requisito 1 (2893)
UPDATE honor_requirements SET is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = 2893;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 7510;
UPDATE honor_requirements SET parent_id = 7510, requirement_number = 1101, modified_at = now() WHERE requirement_id = 7511;
UPDATE honor_requirements SET parent_id = 7510, requirement_number = 1102, modified_at = now() WHERE requirement_id = 7512;
UPDATE honor_requirements SET parent_id = 7510, requirement_number = 1103, modified_at = now() WHERE requirement_id = 7513;

-- Insectos - Avanzado · requisito 9 (2906)
UPDATE honor_requirements SET is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = 2906;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 7522;
UPDATE honor_requirements SET parent_id = 7522, requirement_number = 9101, modified_at = now() WHERE requirement_id = 7523;
UPDATE honor_requirements SET parent_id = 7522, requirement_number = 9102, modified_at = now() WHERE requirement_id = 7524;
UPDATE honor_requirements SET parent_id = 7522, requirement_number = 9103, modified_at = now() WHERE requirement_id = 7525;
UPDATE honor_requirements SET parent_id = 7522, requirement_number = 9104, modified_at = now() WHERE requirement_id = 7526;
UPDATE honor_requirements SET parent_id = 7522, requirement_number = 9105, modified_at = now() WHERE requirement_id = 7527;
UPDATE honor_requirements SET parent_id = 7522, requirement_number = 9106, modified_at = now() WHERE requirement_id = 7528;

-- Mamíferos Pequeños Como Mascotas · requisito 5 (3227)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 7796;
UPDATE honor_requirements SET parent_id = 7796, requirement_number = 5101, modified_at = now() WHERE requirement_id = 7797;
UPDATE honor_requirements SET parent_id = 7796, requirement_number = 5102, modified_at = now() WHERE requirement_id = 7798;
UPDATE honor_requirements SET parent_id = 7796, requirement_number = 5103, modified_at = now() WHERE requirement_id = 7799;
UPDATE honor_requirements SET parent_id = 7796, requirement_number = 5104, modified_at = now() WHERE requirement_id = 7800;
UPDATE honor_requirements SET parent_id = 7796, requirement_number = 5105, modified_at = now() WHERE requirement_id = 7801;
UPDATE honor_requirements SET parent_id = 7796, requirement_number = 5106, modified_at = now() WHERE requirement_id = 7802;
UPDATE honor_requirements SET parent_id = 7796, requirement_number = 5107, modified_at = now() WHERE requirement_id = 7803;
UPDATE honor_requirements SET parent_id = 7796, requirement_number = 5108, modified_at = now() WHERE requirement_id = 7804;

-- Mayordomía · requisito 6 (3294)
UPDATE honor_requirements SET is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = 3294;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 7831;
UPDATE honor_requirements SET parent_id = 7831, requirement_number = 6201, modified_at = now() WHERE requirement_id = 7832;
UPDATE honor_requirements SET parent_id = 7831, requirement_number = 6202, modified_at = now() WHERE requirement_id = 7833;
UPDATE honor_requirements SET parent_id = 7831, requirement_number = 6203, modified_at = now() WHERE requirement_id = 7834;
UPDATE honor_requirements SET parent_id = 7831, requirement_number = 6204, modified_at = now() WHERE requirement_id = 7835;
UPDATE honor_requirements SET parent_id = 7831, requirement_number = 6205, modified_at = now() WHERE requirement_id = 7836;
UPDATE honor_requirements SET parent_id = 7831, requirement_number = 6206, modified_at = now() WHERE requirement_id = 7837;
UPDATE honor_requirements SET parent_id = 7831, requirement_number = 6207, modified_at = now() WHERE requirement_id = 7838;
UPDATE honor_requirements SET parent_id = 7831, requirement_number = 6208, modified_at = now() WHERE requirement_id = 7839;

-- Mensajera de Dios · requisito 1 (3322)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 7858;
UPDATE honor_requirements SET parent_id = 7858, requirement_number = 1401, modified_at = now() WHERE requirement_id = 7859;
UPDATE honor_requirements SET parent_id = 7858, requirement_number = 1402, modified_at = now() WHERE requirement_id = 7860;
UPDATE honor_requirements SET parent_id = 7858, requirement_number = 1403, modified_at = now() WHERE requirement_id = 7861;
UPDATE honor_requirements SET parent_id = 7858, requirement_number = 1404, modified_at = now() WHERE requirement_id = 7862;
UPDATE honor_requirements SET parent_id = 7858, requirement_number = 1405, modified_at = now() WHERE requirement_id = 7863;
UPDATE honor_requirements SET parent_id = 7858, requirement_number = 1406, modified_at = now() WHERE requirement_id = 7864;
UPDATE honor_requirements SET parent_id = 7858, requirement_number = 1407, modified_at = now() WHERE requirement_id = 7865;
UPDATE honor_requirements SET parent_id = 7858, requirement_number = 1408, modified_at = now() WHERE requirement_id = 7866;
UPDATE honor_requirements SET parent_id = 7858, requirement_number = 1409, modified_at = now() WHERE requirement_id = 7867;
UPDATE honor_requirements SET parent_id = 7858, requirement_number = 1410, modified_at = now() WHERE requirement_id = 7868;

-- Ministerio de Transmisión de Medios · requisito 11 (3385)
UPDATE honor_requirements SET is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = 3385;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 7928;
UPDATE honor_requirements SET parent_id = 7928, requirement_number = 11101, modified_at = now() WHERE requirement_id = 7929;
UPDATE honor_requirements SET parent_id = 7928, requirement_number = 11102, modified_at = now() WHERE requirement_id = 7930;
UPDATE honor_requirements SET parent_id = 7928, requirement_number = 11103, modified_at = now() WHERE requirement_id = 7931;
UPDATE honor_requirements SET parent_id = 7928, requirement_number = 11104, modified_at = now() WHERE requirement_id = 7932;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 7933;
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 414, 7933, 11201, 'i', '¿Cuál es el formato del programa (entrevista, discusión grupal, presentación individual, etc.)?' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 7933 AND display_label = 'i' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 414, 7933, 11202, 'ii', '¿Cuánto dura el programa?' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 7933 AND display_label = 'ii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 414, 7933, 11203, 'iii', '¿Cuál es el propósito del programa o la información presentada?' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 7933 AND display_label = 'iii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 414, 7933, 11204, 'iv', '¿Cuántas veces se ha visto o tocado? ¿O cuántas personas han sintonizado? (Si es aplicable)' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 7933 AND display_label = 'iv' AND active);
UPDATE honor_requirements SET parent_id = 7933, requirement_number = 11205, modified_at = now() WHERE requirement_id = 7934;
UPDATE honor_requirements SET parent_id = 7933, requirement_number = 11206, modified_at = now() WHERE requirement_id = 7935;
UPDATE honor_requirements SET parent_id = 7933, requirement_number = 11207, modified_at = now() WHERE requirement_id = 7936;
UPDATE honor_requirements SET parent_id = 7933, requirement_number = 11208, modified_at = now() WHERE requirement_id = 7937;

-- Montañas · requisito 6 (3477)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = 7977;
UPDATE honor_requirements SET parent_id = 7977, requirement_number = 6101, modified_at = now() WHERE requirement_id = 7978;
UPDATE honor_requirements SET parent_id = 7977, requirement_number = 6102, modified_at = now() WHERE requirement_id = 7979;
UPDATE honor_requirements SET parent_id = 7977, requirement_number = 6103, modified_at = now() WHERE requirement_id = 7980;
UPDATE honor_requirements SET parent_id = 7977, requirement_number = 6104, modified_at = now() WHERE requirement_id = 7981;

-- Navegación a Vela · requisito 5 (3638)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 8028;
UPDATE honor_requirements SET parent_id = 8028, requirement_number = 5201, modified_at = now() WHERE requirement_id = 8029;
UPDATE honor_requirements SET parent_id = 8028, requirement_number = 5202, modified_at = now() WHERE requirement_id = 8030;
UPDATE honor_requirements SET parent_id = 8028, requirement_number = 5203, modified_at = now() WHERE requirement_id = 8031;
UPDATE honor_requirements SET parent_id = 8028, requirement_number = 5204, modified_at = now() WHERE requirement_id = 8032;
UPDATE honor_requirements SET parent_id = 8028, requirement_number = 5205, modified_at = now() WHERE requirement_id = 8033;

-- Orientación con GPS · requisito 13 (3805)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 8151;
UPDATE honor_requirements SET parent_id = 8151, requirement_number = 13201, modified_at = now() WHERE requirement_id = 8152;
UPDATE honor_requirements SET parent_id = 8151, requirement_number = 13202, modified_at = now() WHERE requirement_id = 8153;
UPDATE honor_requirements SET parent_id = 8151, requirement_number = 13203, modified_at = now() WHERE requirement_id = 8154;

-- Predicar · requisito 5 (4158)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 8364;
UPDATE honor_requirements SET parent_id = 8364, requirement_number = 5301, modified_at = now() WHERE requirement_id = 8365;
UPDATE honor_requirements SET parent_id = 8364, requirement_number = 5302, modified_at = now() WHERE requirement_id = 8366;
UPDATE honor_requirements SET parent_id = 8364, requirement_number = 5303, modified_at = now() WHERE requirement_id = 8367;
UPDATE honor_requirements SET parent_id = 8364, requirement_number = 5304, modified_at = now() WHERE requirement_id = 8368;
UPDATE honor_requirements SET parent_id = 8364, requirement_number = 5305, modified_at = now() WHERE requirement_id = 8369;
UPDATE honor_requirements SET parent_id = 8364, requirement_number = 5306, modified_at = now() WHERE requirement_id = 8370;
UPDATE honor_requirements SET parent_id = 8364, requirement_number = 5307, modified_at = now() WHERE requirement_id = 8371;

-- Prevención de Enfermedades Tropicales · requisito 4 (4203)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 8393;
UPDATE honor_requirements SET parent_id = 8393, requirement_number = 4501, modified_at = now() WHERE requirement_id = 8394;
UPDATE honor_requirements SET parent_id = 8393, requirement_number = 4502, modified_at = now() WHERE requirement_id = 8395;
UPDATE honor_requirements SET parent_id = 8393, requirement_number = 4503, modified_at = now() WHERE requirement_id = 8396;

-- Procesar Texto · requisito 5 (4278)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 8470;
UPDATE honor_requirements SET parent_id = 8470, requirement_number = 5101, modified_at = now() WHERE requirement_id = 8471;
UPDATE honor_requirements SET parent_id = 8470, requirement_number = 5102, modified_at = now() WHERE requirement_id = 8472;
UPDATE honor_requirements SET parent_id = 8470, requirement_number = 5103, modified_at = now() WHERE requirement_id = 8473;
UPDATE honor_requirements SET parent_id = 8470, requirement_number = 5104, modified_at = now() WHERE requirement_id = 8474;
UPDATE honor_requirements SET parent_id = 8470, requirement_number = 5105, modified_at = now() WHERE requirement_id = 8475;
UPDATE honor_requirements SET parent_id = 8470, requirement_number = 5106, modified_at = now() WHERE requirement_id = 8476;

-- Remo · requisito 3 (4447)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 8569;
UPDATE honor_requirements SET parent_id = 8569, requirement_number = 3301, modified_at = now() WHERE requirement_id = 8570;
UPDATE honor_requirements SET parent_id = 8569, requirement_number = 3302, modified_at = now() WHERE requirement_id = 8571;
UPDATE honor_requirements SET parent_id = 8569, requirement_number = 3303, modified_at = now() WHERE requirement_id = 8572;
UPDATE honor_requirements SET parent_id = 8569, requirement_number = 3304, modified_at = now() WHERE requirement_id = 8573;
UPDATE honor_requirements SET parent_id = 8569, requirement_number = 3305, modified_at = now() WHERE requirement_id = 8574;

-- Salud y Curación · requisito 5 (4581)
UPDATE honor_requirements SET is_choice_group = true, choice_min = 1, modified_at = now() WHERE requirement_id = 4581;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 8657;
UPDATE honor_requirements SET parent_id = 8657, requirement_number = 5201, modified_at = now() WHERE requirement_id = 8658;
UPDATE honor_requirements SET parent_id = 8657, requirement_number = 5202, modified_at = now() WHERE requirement_id = 8659;
UPDATE honor_requirements SET parent_id = 8657, requirement_number = 5203, modified_at = now() WHERE requirement_id = 8660;
UPDATE honor_requirements SET parent_id = 8657, requirement_number = 5204, modified_at = now() WHERE requirement_id = 8661;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 8663;
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 603, 8663, 5401, 'i', 'Observar las zonas de trabajo en el departamento' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 8663 AND display_label = 'i' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 603, 8663, 5402, 'ii', 'Obtener una charla introductoria de los equipos utilizados en el departamento y cómo funciona' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 8663 AND display_label = 'ii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 603, 8663, 5403, 'iii', 'Conocer los pasos que toma un paciente cuando visita al departamento.' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 8663 AND display_label = 'iii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 603, 8663, 5404, 'iv', '¿Cuántas personas se necesitan en el departamento?' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 8663 AND display_label = 'iv' AND active);
UPDATE honor_requirements SET parent_id = 8663, requirement_number = 5405, modified_at = now() WHERE requirement_id = 8664;

-- Teñido Anudado - Avanzado · requisito 3 (4998)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 8953;
UPDATE honor_requirements SET parent_id = 8953, requirement_number = 3101, modified_at = now() WHERE requirement_id = 8954;
UPDATE honor_requirements SET parent_id = 8953, requirement_number = 3102, modified_at = now() WHERE requirement_id = 8955;
UPDATE honor_requirements SET parent_id = 8953, requirement_number = 3103, modified_at = now() WHERE requirement_id = 8956;
UPDATE honor_requirements SET parent_id = 8953, requirement_number = 3104, modified_at = now() WHERE requirement_id = 8957;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 8958;
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 326, 8958, 3201, 'i', 'Nudo' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 8958 AND display_label = 'i' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 326, 8958, 3202, 'ii', 'Espiral' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 8958 AND display_label = 'ii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 326, 8958, 3203, 'iii', 'Rosetas' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 8958 AND display_label = 'iii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 326, 8958, 3204, 'iv', 'Círculos' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 8958 AND display_label = 'iv' AND active);
UPDATE honor_requirements SET parent_id = 8958, requirement_number = 3205, modified_at = now() WHERE requirement_id = 8959;

-- Trabajos de Aguja · requisito 1 (5123)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 9041;
UPDATE honor_requirements SET parent_id = 9041, requirement_number = 1201, modified_at = now() WHERE requirement_id = 9042;
UPDATE honor_requirements SET parent_id = 9041, requirement_number = 1202, modified_at = now() WHERE requirement_id = 9043;
UPDATE honor_requirements SET parent_id = 9041, requirement_number = 1203, modified_at = now() WHERE requirement_id = 9044;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 9046;
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 328, 9046, 1401, 'i', 'Aplicación' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 9046 AND display_label = 'i' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 328, 9046, 1402, 'ii', 'Vainillas o Vainicas' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 9046 AND display_label = 'ii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 328, 9046, 1403, 'iii', 'Punto smock (frunce)' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 9046 AND display_label = 'iii' AND active);
UPDATE honor_requirements SET parent_id = 9046, requirement_number = 1404, modified_at = now() WHERE requirement_id = 9047;
UPDATE honor_requirements SET parent_id = 9046, requirement_number = 1405, modified_at = now() WHERE requirement_id = 9048;

-- Viajes - Avanzado · requisito 5 (5300)
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 9153;
UPDATE honor_requirements SET parent_id = 9153, requirement_number = 5101, modified_at = now() WHERE requirement_id = 9154;
UPDATE honor_requirements SET parent_id = 9153, requirement_number = 5102, modified_at = now() WHERE requirement_id = 9155;
UPDATE honor_requirements SET parent_id = 9153, requirement_number = 5103, modified_at = now() WHERE requirement_id = 9156;
UPDATE honor_requirements SET has_sub_items = true, is_choice_group = false, choice_min = NULL, modified_at = now() WHERE requirement_id = 9157;
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 138, 9157, 5201, 'i', 'Pasaje aéreo de ida y venida a ese país' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 9157 AND display_label = 'i' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 138, 9157, 5202, 'ii', 'Alquiler de automóviles (económico/compacto)' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 9157 AND display_label = 'ii' AND active);
INSERT INTO honor_requirements (honor_id, parent_id, requirement_number, display_label, requirement_text) SELECT 138, 9157, 5203, 'iii', 'Costo de la gasolina legítimo (recordar que diferentes países tienen la lista de precios de la gasolina por litro o por galón)' WHERE NOT EXISTS (SELECT 1 FROM honor_requirements WHERE parent_id = 9157 AND display_label = 'iii' AND active);
UPDATE honor_requirements SET parent_id = 9157, requirement_number = 5204, modified_at = now() WHERE requirement_id = 9158;
UPDATE honor_requirements SET parent_id = 9157, requirement_number = 5205, modified_at = now() WHERE requirement_id = 9159;
UPDATE honor_requirements SET parent_id = 9157, requirement_number = 5206, modified_at = now() WHERE requirement_id = 9160;
UPDATE honor_requirements SET parent_id = 9157, requirement_number = 5207, modified_at = now() WHERE requirement_id = 9161;
UPDATE honor_requirements SET parent_id = 9157, requirement_number = 5208, modified_at = now() WHERE requirement_id = 9162;
