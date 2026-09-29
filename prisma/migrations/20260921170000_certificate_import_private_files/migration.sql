-- Private certificate-import file metadata.
-- Existing rows stay CONFIRMED so current drafts keep their stored reference.
-- They have no object_key, so download does not treat them as sealed bytes.

DO $$
BEGIN
  CREATE TYPE certificate_import_file_status_enum AS ENUM (
    'PENDING_UPLOAD',
    'CONFIRMED',
    'REJECTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE certificate_import_file_jurisdiction_enum AS ENUM (
    'CAMPO_LOCAL',
    'INSTITUTIONAL'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE certificate_bulk_import_files
  ADD COLUMN IF NOT EXISTS upload_status certificate_import_file_status_enum NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN IF NOT EXISTS staging_key character varying(500),
  ADD COLUMN IF NOT EXISTS object_key character varying(500),
  ADD COLUMN IF NOT EXISTS size_bytes bigint,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamp(6) with time zone,
  ADD COLUMN IF NOT EXISTS jurisdiction certificate_import_file_jurisdiction_enum NOT NULL DEFAULT 'CAMPO_LOCAL';
