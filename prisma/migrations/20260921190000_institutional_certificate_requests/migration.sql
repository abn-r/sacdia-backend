-- Institutional inbox for discontinued Guía Mayor classes.
-- Approving a request does not create an enrollment.

DO $$
BEGIN
  CREATE TYPE institutional_certificate_request_status_enum AS ENUM (
    'PENDING_REVIEW',
    'APPROVED',
    'REJECTED'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE institutional_certificate_request_source_enum AS ENUM (
    'MANUAL',
    'OCR'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS institutional_certificate_requests (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (user_id),
  class_id integer NOT NULL REFERENCES classes (class_id),
  file_id uuid NOT NULL REFERENCES certificate_bulk_import_files (file_id),
  batch_id uuid REFERENCES certificate_bulk_import_batches (batch_id),
  source institutional_certificate_request_source_enum NOT NULL DEFAULT 'MANUAL',
  completed_at date NOT NULL,
  ecclesiastical_year_id integer REFERENCES ecclesiastical_years (year_id),
  status institutional_certificate_request_status_enum NOT NULL DEFAULT 'PENDING_REVIEW',
  revision integer NOT NULL DEFAULT 0,
  decision_reason text,
  reviewed_by_id uuid REFERENCES users (user_id),
  reviewed_at timestamp(6) with time zone,
  predecessor_request_id uuid REFERENCES institutional_certificate_requests (request_id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now(),
  modified_at timestamp(6) with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_institutional_certificate_requests_user_status
  ON institutional_certificate_requests (user_id, status);
CREATE INDEX IF NOT EXISTS idx_institutional_certificate_requests_status_created
  ON institutional_certificate_requests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_institutional_certificate_requests_class
  ON institutional_certificate_requests (class_id);
CREATE INDEX IF NOT EXISTS idx_institutional_certificate_requests_file
  ON institutional_certificate_requests (file_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_institutional_certificate_request_open
  ON institutional_certificate_requests (user_id, class_id, file_id, completed_at)
  WHERE active AND status IN ('PENDING_REVIEW', 'APPROVED');

CREATE TABLE IF NOT EXISTS institutional_certificate_request_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES institutional_certificate_requests (request_id) ON DELETE CASCADE,
  action character varying(50) NOT NULL,
  performed_by_id uuid REFERENCES users (user_id),
  comment text,
  revision integer NOT NULL,
  created_at timestamp(6) with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_institutional_certificate_events_request
  ON institutional_certificate_request_events (request_id, created_at);
