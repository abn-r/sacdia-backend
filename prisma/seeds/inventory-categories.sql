INSERT INTO inventory_categories (name, icon, active, created_at, modified_at) VALUES
('Camping', 0, true, NOW(), NOW()),
('Cocina', 0, true, NOW(), NOW()),
('Uniformes', 0, true, NOW(), NOW()),
('Herramientas', 0, true, NOW(), NOW()),
('Primeros Auxilios', 0, true, NOW(), NOW()),
('Deportes', 0, true, NOW(), NOW()),
('Comunicación', 0, true, NOW(), NOW()),
('Oficina', 0, true, NOW(), NOW())
ON CONFLICT DO NOTHING;
