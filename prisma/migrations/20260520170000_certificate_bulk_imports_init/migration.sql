-- Migration: 20260520170000_certificate_bulk_imports_init
-- Date: 2026-05-20
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Introduces the OCR certificate bulk import staging schema used by the
-- mobile app and the Campo Local admin review console.
--
-- The final source of truth stays in the existing domain tables
-- (users_honors / enrollments / evidence_files). These tables are only the
-- review/audit staging layer for OCR rows, uploaded certificate files, and
-- reviewer/member events.
--
-- Idempotent: enum creation catches duplicate_object and tables/indexes use
-- IF NOT EXISTS so development databases can safely receive the migration
-- after schema drift from prisma db push.

-- ─── STEP 1: Enums ───────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "certificate_bulk_import_batch_status_enum" AS ENUM (
    'DRAFT',
    'READY_TO_SUBMIT',
    'SUBMITTED',
    'PARTIALLY_APPROVED',
    'APPROVED',
    'REJECTED',
    'NEEDS_CORRECTION'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "certificate_bulk_import_item_status_enum" AS ENUM (
    'NEEDS_REVIEW',
    'READY',
    'SUBMITTED',
    'APPROVED',
    'REJECTED',
    'RESUBMITTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "certificate_bulk_import_item_type_enum" AS ENUM (
    'HONOR',
    'CLASS'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "certificate_bulk_import_applied_entity_type_enum" AS ENUM (
    'USER_HONOR',
    'ENROLLMENT'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── STEP 2: Tables in FK-safe order ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS certificate_bulk_import_batches (
  batch_id        UUID NOT NULL DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  local_field_id  INT NULL,
  status          "certificate_bulk_import_batch_status_enum" NOT NULL DEFAULT 'DRAFT',
  raw_ocr_payload JSONB NULL,
  submitted_at    TIMESTAMPTZ NULL,
  reviewed_at     TIMESTAMPTZ NULL,
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT certificate_bulk_import_batches_pkey PRIMARY KEY (batch_id),
  CONSTRAINT certificate_bulk_import_batches_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(user_id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT certificate_bulk_import_batches_local_field_id_fkey
    FOREIGN KEY (local_field_id) REFERENCES local_fields(local_field_id)
    ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS certificate_bulk_import_items (
  item_id             UUID NOT NULL DEFAULT gen_random_uuid(),
  batch_id            UUID NOT NULL,
  item_type           "certificate_bulk_import_item_type_enum" NOT NULL,
  honor_id            INT NULL,
  class_id            INT NULL,
  detected_name       VARCHAR(255) NULL,
  detected_date       DATE NULL,
  completed_at        DATE NULL,
  ocr_confidence      DOUBLE PRECISION NULL,
  field_confidence    JSONB NULL,
  status              "certificate_bulk_import_item_status_enum" NOT NULL DEFAULT 'NEEDS_REVIEW',
  rejection_reason    TEXT NULL,
  reviewed_by_id      UUID NULL,
  reviewed_at         TIMESTAMPTZ NULL,
  applied_entity_type "certificate_bulk_import_applied_entity_type_enum" NULL,
  applied_entity_id   INT NULL,
  active              BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  modified_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT certificate_bulk_import_items_pkey PRIMARY KEY (item_id),
  CONSTRAINT certificate_bulk_import_items_batch_id_fkey
    FOREIGN KEY (batch_id) REFERENCES certificate_bulk_import_batches(batch_id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT certificate_bulk_import_items_honor_id_fkey
    FOREIGN KEY (honor_id) REFERENCES honors(honor_id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT certificate_bulk_import_items_class_id_fkey
    FOREIGN KEY (class_id) REFERENCES classes(class_id)
    ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT certificate_bulk_import_items_reviewed_by_id_fkey
    FOREIGN KEY (reviewed_by_id) REFERENCES users(user_id)
    ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS certificate_bulk_import_files (
  file_id        UUID NOT NULL DEFAULT gen_random_uuid(),
  batch_id       UUID NOT NULL,
  file_url       VARCHAR(500) NOT NULL,
  file_name      VARCHAR(255) NOT NULL,
  file_type      VARCHAR(50) NOT NULL,
  uploaded_by_id UUID NOT NULL,
  ocr_raw_text   TEXT NULL,
  active         BOOLEAN NOT NULL DEFAULT true,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT certificate_bulk_import_files_pkey PRIMARY KEY (file_id),
  CONSTRAINT certificate_bulk_import_files_batch_id_fkey
    FOREIGN KEY (batch_id) REFERENCES certificate_bulk_import_batches(batch_id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT certificate_bulk_import_files_uploaded_by_id_fkey
    FOREIGN KEY (uploaded_by_id) REFERENCES users(user_id)
    ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS certificate_bulk_import_item_events (
  event_id        UUID NOT NULL DEFAULT gen_random_uuid(),
  batch_id        UUID NOT NULL,
  item_id         UUID NULL,
  action          VARCHAR(50) NOT NULL,
  performed_by_id UUID NULL,
  comment         TEXT NULL,
  payload         JSONB NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT certificate_bulk_import_item_events_pkey PRIMARY KEY (event_id),
  CONSTRAINT certificate_bulk_import_item_events_batch_id_fkey
    FOREIGN KEY (batch_id) REFERENCES certificate_bulk_import_batches(batch_id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT certificate_bulk_import_item_events_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES certificate_bulk_import_items(item_id)
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT certificate_bulk_import_item_events_performed_by_id_fkey
    FOREIGN KEY (performed_by_id) REFERENCES users(user_id)
    ON DELETE RESTRICT ON UPDATE NO ACTION
);

-- ─── STEP 3: Query indexes ───────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_certificate_bulk_batches_user_status
  ON certificate_bulk_import_batches (user_id, status);

CREATE INDEX IF NOT EXISTS idx_certificate_bulk_batches_lf_status
  ON certificate_bulk_import_batches (local_field_id, status);

CREATE INDEX IF NOT EXISTS idx_certificate_bulk_batches_status_submitted
  ON certificate_bulk_import_batches (status, submitted_at);

CREATE INDEX IF NOT EXISTS idx_certificate_bulk_items_batch
  ON certificate_bulk_import_items (batch_id);

CREATE INDEX IF NOT EXISTS idx_certificate_bulk_items_status
  ON certificate_bulk_import_items (status);

CREATE INDEX IF NOT EXISTS idx_certificate_bulk_items_honor
  ON certificate_bulk_import_items (honor_id);

CREATE INDEX IF NOT EXISTS idx_certificate_bulk_items_class
  ON certificate_bulk_import_items (class_id);

CREATE INDEX IF NOT EXISTS idx_certificate_bulk_items_applied_entity
  ON certificate_bulk_import_items (applied_entity_type, applied_entity_id);

CREATE INDEX IF NOT EXISTS idx_certificate_bulk_files_batch
  ON certificate_bulk_import_files (batch_id);

CREATE INDEX IF NOT EXISTS idx_certificate_bulk_files_uploaded_by
  ON certificate_bulk_import_files (uploaded_by_id);

CREATE INDEX IF NOT EXISTS idx_certificate_bulk_events_batch_created
  ON certificate_bulk_import_item_events (batch_id, created_at);

CREATE INDEX IF NOT EXISTS idx_certificate_bulk_events_item_created
  ON certificate_bulk_import_item_events (item_id, created_at);

CREATE INDEX IF NOT EXISTS idx_certificate_bulk_events_performed_by
  ON certificate_bulk_import_item_events (performed_by_id);
