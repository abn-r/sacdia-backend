-- Migration: 20261010130000_certificate_import_ocr_pages (M2)
-- Archivo y página del comprobante (D4, D12). Slice B4 del plan
-- docs/plans/2026-10-09-certificate-import-instructor-data-model.md (secciones 2.2 a 2.5 y 4.7).
--
-- - certificate_bulk_import_files.page_count: páginas del archivo, se escribe al
--   confirmar (PDF: conteo del validador; imagen: 1). Archivos anteriores: NULL.
-- - certificate_bulk_import_items.source_file_id / source_page: archivo y página
--   (dentro de ese archivo) donde el OCR leyó la fila. Solo las escribe el parser.
--   Filas manuales y anteriores a M2: NULL.
--
-- Aditiva y segura con datos existentes: columnas NULL sin default (solo
-- metadatos), FK y CHECK con NOT VALID + VALIDATE CONSTRAINT (no bloquea
-- escrituras) e índice parcial CREATE INDEX CONCURRENTLY.
--
-- CÓMO APLICARLA (manual, Neon dev -> staging -> prod, ANTES de desplegar el
-- backend que usa las columnas; la shadow DB está rota, no uses migrate dev).
-- Puede aplicarse antes o después de M1 (20261010120000): no dependen entre sí.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261010130000_certificate_import_ocr_pages/migration.sql
--
-- IMPORTANTE: NO uses `psql -1` / `--single-transaction` ni envuelvas el archivo
-- en BEGIN/COMMIT. CREATE INDEX CONCURRENTLY no puede correr dentro de una
-- transacción. Con `-f` cada sentencia corre en su propia transacción implícita.
-- El archivo es re-ejecutable (IF NOT EXISTS / DROP CONSTRAINT IF EXISTS). Si el
-- CREATE INDEX CONCURRENTLY falla a medias deja un índice INVALID:
-- `DROP INDEX CONCURRENTLY idx_certificate_bulk_items_source_file;` y vuelve a correrlo.
--
-- Después de aplicar, registrar en _prisma_migrations (flujo manual del repo):
--   corepack pnpm exec prisma migrate resolve --applied 20261010130000_certificate_import_ocr_pages
--
-- Rollback: solo hacia adelante. Antes de que haya datos reales: DROP INDEX,
-- DROP CONSTRAINT y DROP COLUMN en el orden inverso.
--
-- NO hay CHECK entre source_page y source_file_id ("si hay página, hay archivo"):
-- con ON DELETE SET NULL, borrar un archivo dejaría source_file_id en NULL, el
-- CHECK fallaría y bloquearía el borrado. El cliente ignora la página si no hay
-- archivo de origen. Tampoco se repite el tope de 5 páginas (vive en
-- CERTIFICATE_IMPORT_MAX_PDF_PAGES).

-- ============================================================
-- 1. Columnas (nullable, sin default)
-- ============================================================
ALTER TABLE certificate_bulk_import_files
  ADD COLUMN IF NOT EXISTS page_count smallint;

ALTER TABLE certificate_bulk_import_items
  ADD COLUMN IF NOT EXISTS source_page smallint,
  ADD COLUMN IF NOT EXISTS source_file_id uuid;

-- ============================================================
-- 2. FK source_file_id -> certificate_bulk_import_files(file_id)
--    ON DELETE SET NULL: es una pista de navegación, no un dato de dominio.
--    Perder el archivo no debe borrar la fila que el miembro declaró.
-- ============================================================
ALTER TABLE certificate_bulk_import_items
  DROP CONSTRAINT IF EXISTS certificate_bulk_import_items_source_file_id_fkey,
  ADD CONSTRAINT certificate_bulk_import_items_source_file_id_fkey
    FOREIGN KEY (source_file_id) REFERENCES certificate_bulk_import_files (file_id)
    ON DELETE SET NULL ON UPDATE NO ACTION NOT VALID;

-- ============================================================
-- 3. CHECK (NOT VALID)
-- ============================================================
ALTER TABLE certificate_bulk_import_items
  DROP CONSTRAINT IF EXISTS certificate_bulk_import_items_source_page_ck,
  ADD CONSTRAINT certificate_bulk_import_items_source_page_ck
    CHECK (source_page IS NULL OR source_page >= 1) NOT VALID;

ALTER TABLE certificate_bulk_import_files
  DROP CONSTRAINT IF EXISTS certificate_bulk_import_files_page_count_ck,
  ADD CONSTRAINT certificate_bulk_import_files_page_count_ck
    CHECK (page_count IS NULL OR page_count >= 1) NOT VALID;

-- ============================================================
-- 4. VALIDATE (todas las filas existentes tienen NULL: validación trivial y
--    sin bloquear escrituras)
-- ============================================================
ALTER TABLE certificate_bulk_import_items VALIDATE CONSTRAINT certificate_bulk_import_items_source_file_id_fkey;
ALTER TABLE certificate_bulk_import_items VALIDATE CONSTRAINT certificate_bulk_import_items_source_page_ck;
ALTER TABLE certificate_bulk_import_files VALIDATE CONSTRAINT certificate_bulk_import_files_page_count_ck;

-- ============================================================
-- 5. Índice parcial (CONCURRENTLY: fuera de transacción). Acelera el SET NULL
--    del FK al borrar un archivo.
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_certificate_bulk_items_source_file
  ON certificate_bulk_import_items (source_file_id)
  WHERE source_file_id IS NOT NULL;
