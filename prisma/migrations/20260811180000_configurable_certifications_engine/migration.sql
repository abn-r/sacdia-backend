-- Configurable certifications engine (expand/backfill). Do not apply against Neon from agent tooling.
-- Legacy columns and certification_module_progress are retained for compatibility.

DO $$ BEGIN
  CREATE TYPE certification_version_status_enum AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE certification_enrollment_status_enum AS ENUM (
    'ENROLLED',
    'IN_PROGRESS',
    'READY_FOR_CLOSEOUT',
    'SUBMITTED_FOR_FINAL_REVIEW',
    'APPROVED',
    'CERTIFIED',
    'WITHDRAWN',
    'EXPIRED',
    'CHANGES_REQUESTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE certification_requirement_status_enum AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'CHANGES_REQUESTED',
    'APPROVED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE certification_component_type_enum AS ENUM (
    'TEXT_RESPONSE',
    'FILE_EVIDENCE',
    'LINKED_HONOR',
    'LINKED_ACTIVITY',
    'ATTESTATION',
    'AUTO_VALIDATION'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE certification_eligibility_rule_type_enum AS ENUM (
    'MIN_AGE',
    'BAPTIZED',
    'INVESTED_CLASS',
    'ACTIVE_CLUB_TYPE',
    'ACTIVE_ROLE'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE certification_evidence_upload_status_enum AS ENUM (
    'PENDING_UPLOAD',
    'CONFIRMED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE certification_review_event_type_enum AS ENUM (
    'REQUIREMENT_SUBMITTED',
    'REQUIREMENT_CHANGES_REQUESTED',
    'REQUIREMENT_APPROVED',
    'REQUIREMENT_RESUBMITTED',
    'CLOSEOUT_SUBMITTED',
    'CLOSEOUT_CHANGES_REQUESTED',
    'CLOSEOUT_APPROVED',
    'CERTIFIED',
    'WITHDRAWN'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE certification_closeout_review_status_enum AS ENUM (
    'PENDING',
    'SUBMITTED',
    'CHANGES_REQUESTED',
    'APPROVED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "certification_versions" (
  "certification_version_id" SERIAL PRIMARY KEY,
  "certification_id" INTEGER NOT NULL,
  "version_number" INTEGER NOT NULL,
  "status" certification_version_status_enum NOT NULL DEFAULT 'DRAFT',
  "title" VARCHAR(255),
  "description" TEXT,
  "min_duration_months" INTEGER,
  "max_duration_months" INTEGER,
  "published_at" TIMESTAMPTZ(6),
  "retired_at" TIMESTAMPTZ(6),
  "published_by_id" UUID,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "certification_versions_certification_id_fkey"
    FOREIGN KEY ("certification_id") REFERENCES "certifications"("certification_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "certification_versions_published_by_id_fkey"
    FOREIGN KEY ("published_by_id") REFERENCES "users"("user_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "certification_versions_certification_id_version_number_key"
    UNIQUE ("certification_id", "version_number")
);

CREATE INDEX IF NOT EXISTS "idx_certification_versions_status"
  ON "certification_versions"("status");

CREATE TABLE IF NOT EXISTS "certification_eligibility_rules" (
  "eligibility_rule_id" SERIAL PRIMARY KEY,
  "certification_version_id" INTEGER NOT NULL,
  "rule_type" certification_eligibility_rule_type_enum NOT NULL,
  "configuration" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "class_id" INTEGER,
  "club_type_id" INTEGER,
  "role_id" UUID,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "certification_eligibility_rules_version_fkey"
    FOREIGN KEY ("certification_version_id") REFERENCES "certification_versions"("certification_version_id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "certification_eligibility_rules_class_id_fkey"
    FOREIGN KEY ("class_id") REFERENCES "classes"("class_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "certification_eligibility_rules_club_type_id_fkey"
    FOREIGN KEY ("club_type_id") REFERENCES "club_types"("club_type_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "certification_eligibility_rules_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "roles"("role_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_cert_eligibility_rules_version"
  ON "certification_eligibility_rules"("certification_version_id");

-- Backfill published version 1 for each existing certification identity.
INSERT INTO "certification_versions" (
  "certification_id",
  "version_number",
  "status",
  "title",
  "description",
  "published_at",
  "active",
  "created_at",
  "modified_at"
)
SELECT
  c."certification_id",
  1,
  'PUBLISHED'::certification_version_status_enum,
  c."name",
  c."description",
  CURRENT_TIMESTAMP,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "certifications" c
WHERE NOT EXISTS (
  SELECT 1
  FROM "certification_versions" v
  WHERE v."certification_id" = c."certification_id"
    AND v."version_number" = 1
);

ALTER TABLE "certification_modules"
  ADD COLUMN IF NOT EXISTS "certification_version_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;

UPDATE "certification_modules" m
SET "certification_version_id" = v."certification_version_id"
FROM "certification_versions" v
WHERE v."certification_id" = m."certification_id"
  AND v."version_number" = 1
  AND m."certification_version_id" IS NULL;

DO $$ BEGIN
  ALTER TABLE "certification_modules"
    ALTER COLUMN "certification_version_id" SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "certification_modules"
    ADD CONSTRAINT "certification_modules_certification_version_id_fkey"
    FOREIGN KEY ("certification_version_id") REFERENCES "certification_versions"("certification_version_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "certification_modules"
  DROP CONSTRAINT IF EXISTS "certification_modules_name_certification_id_key";

DO $$ BEGIN
  ALTER TABLE "certification_modules"
    ADD CONSTRAINT "certification_modules_name_certification_version_id_key"
    UNIQUE ("name", "certification_version_id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_cert_modules_version_sort"
  ON "certification_modules"("certification_version_id", "sort_order");

ALTER TABLE "certification_sections"
  ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "required" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "instructions" TEXT;

CREATE INDEX IF NOT EXISTS "idx_cert_sections_module_sort"
  ON "certification_sections"("module_id", "sort_order");

CREATE TABLE IF NOT EXISTS "certification_requirement_components" (
  "component_id" SERIAL PRIMARY KEY,
  "section_id" INTEGER NOT NULL,
  "component_type" certification_component_type_enum NOT NULL,
  "label" VARCHAR(255) NOT NULL,
  "instructions" TEXT,
  "configuration" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "honor_id" INTEGER,
  "activity_type_id" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "certification_requirement_components_section_id_fkey"
    FOREIGN KEY ("section_id") REFERENCES "certification_sections"("section_id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "certification_requirement_components_honor_id_fkey"
    FOREIGN KEY ("honor_id") REFERENCES "honors"("honor_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "certification_requirement_components_activity_type_id_fkey"
    FOREIGN KEY ("activity_type_id") REFERENCES "activity_types"("activity_type_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_cert_requirement_components_section_sort"
  ON "certification_requirement_components"("section_id", "sort_order");

ALTER TABLE "users_certifications"
  ADD COLUMN IF NOT EXISTS "certification_version_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "status" certification_enrollment_status_enum NOT NULL DEFAULT 'ENROLLED',
  ADD COLUMN IF NOT EXISTS "started_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "certified_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "lock_version" INTEGER NOT NULL DEFAULT 0;

UPDATE "users_certifications" uc
SET
  "certification_version_id" = v."certification_version_id",
  "status" = CASE
    WHEN uc."completion_status" = true THEN 'CERTIFIED'::certification_enrollment_status_enum
    ELSE 'ENROLLED'::certification_enrollment_status_enum
  END,
  "certified_at" = CASE
    WHEN uc."completion_status" = true THEN COALESCE(uc."completion_date", CURRENT_TIMESTAMP)
    ELSE NULL
  END,
  "started_at" = COALESCE(uc."started_at", uc."enrollment_date")
FROM "certification_versions" v
WHERE v."certification_id" = uc."certification_id"
  AND v."version_number" = 1
  AND uc."certification_version_id" IS NULL;

DO $$ BEGIN
  ALTER TABLE "users_certifications"
    ALTER COLUMN "certification_version_id" SET NOT NULL;
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "users_certifications"
    ADD CONSTRAINT "users_certifications_certification_version_id_fkey"
    FOREIGN KEY ("certification_version_id") REFERENCES "certification_versions"("certification_version_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_users_certifications_status"
  ON "users_certifications"("status");

CREATE INDEX IF NOT EXISTS "idx_users_certifications_version"
  ON "users_certifications"("certification_version_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_users_certifications_active_enrollment"
  ON "users_certifications"("user_id", "certification_id", "certification_version_id")
  WHERE "active" = true
    AND "status" NOT IN (
      'WITHDRAWN'::certification_enrollment_status_enum,
      'EXPIRED'::certification_enrollment_status_enum
    );

ALTER TABLE "certification_section_progress"
  ADD COLUMN IF NOT EXISTS "enrollment_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "status" certification_requirement_status_enum NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "reviewed_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "last_review_comment" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewed_by_id" UUID;

-- Bind progress to the newest active enrollment for the same user/cert when unambiguous.
WITH ranked AS (
  SELECT
    p."progress_id",
    uc."enrollment_id",
    ROW_NUMBER() OVER (
      PARTITION BY p."progress_id"
      ORDER BY uc."active" DESC, uc."enrollment_date" DESC, uc."enrollment_id" DESC
    ) AS rn,
    COUNT(*) OVER (PARTITION BY p."progress_id") AS candidate_count
  FROM "certification_section_progress" p
  JOIN "users_certifications" uc
    ON uc."user_id" = p."user_id"
   AND uc."certification_id" = p."certification_id"
  WHERE p."enrollment_id" IS NULL
)
UPDATE "certification_section_progress" p
SET
  "enrollment_id" = ranked."enrollment_id",
  "status" = CASE
    WHEN p."completed" = true THEN 'APPROVED'::certification_requirement_status_enum
    ELSE 'DRAFT'::certification_requirement_status_enum
  END
FROM ranked
WHERE ranked."progress_id" = p."progress_id"
  AND ranked.rn = 1;

DO $$ BEGIN
  ALTER TABLE "certification_section_progress"
    ADD CONSTRAINT "certification_section_progress_enrollment_id_fkey"
    FOREIGN KEY ("enrollment_id") REFERENCES "users_certifications"("enrollment_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "certification_section_progress"
    ADD CONSTRAINT "certification_section_progress_section_id_fkey"
    FOREIGN KEY ("section_id") REFERENCES "certification_sections"("section_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "certification_section_progress"
    ADD CONSTRAINT "certification_section_progress_reviewed_by_id_fkey"
    FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("user_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_cert_section_progress_status"
  ON "certification_section_progress"("status");

CREATE INDEX IF NOT EXISTS "idx_cert_section_progress_enrollment"
  ON "certification_section_progress"("enrollment_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uq_cert_section_progress_enrollment_section"
  ON "certification_section_progress"("enrollment_id", "section_id")
  WHERE "enrollment_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_cert_section_progress_enrollment_section"
  ON "certification_section_progress"("enrollment_id", "section_id");

CREATE TABLE IF NOT EXISTS "certification_component_responses" (
  "response_id" SERIAL PRIMARY KEY,
  "progress_id" INTEGER NOT NULL,
  "component_id" INTEGER NOT NULL,
  "text_value" TEXT,
  "attestation_confirmed" BOOLEAN,
  "linked_user_honor_id" INTEGER,
  "linked_activity_id" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "certification_component_responses_progress_id_fkey"
    FOREIGN KEY ("progress_id") REFERENCES "certification_section_progress"("progress_id")
    ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "certification_component_responses_component_id_fkey"
    FOREIGN KEY ("component_id") REFERENCES "certification_requirement_components"("component_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "certification_component_responses_linked_user_honor_id_fkey"
    FOREIGN KEY ("linked_user_honor_id") REFERENCES "users_honors"("user_honor_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "certification_component_responses_linked_activity_id_fkey"
    FOREIGN KEY ("linked_activity_id") REFERENCES "activities"("activity_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "certification_component_responses_progress_id_component_id_key"
    UNIQUE ("progress_id", "component_id")
);

CREATE TABLE IF NOT EXISTS "certification_evidences" (
  "evidence_id" SERIAL PRIMARY KEY,
  "response_id" INTEGER NOT NULL,
  "object_key" VARCHAR(512) NOT NULL,
  "original_filename" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "checksum_sha256" CHAR(64),
  "upload_status" certification_evidence_upload_status_enum NOT NULL DEFAULT 'PENDING_UPLOAD',
  "uploaded_by_id" UUID NOT NULL,
  "confirmed_at" TIMESTAMPTZ(6),
  "deleted_at" TIMESTAMPTZ(6),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "certification_evidences_response_id_fkey"
    FOREIGN KEY ("response_id") REFERENCES "certification_component_responses"("response_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "certification_evidences_uploaded_by_id_fkey"
    FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("user_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_cert_evidences_response"
  ON "certification_evidences"("response_id");

CREATE INDEX IF NOT EXISTS "idx_cert_evidences_upload_status"
  ON "certification_evidences"("upload_status");

CREATE TABLE IF NOT EXISTS "certification_review_events" (
  "review_event_id" SERIAL PRIMARY KEY,
  "enrollment_id" INTEGER NOT NULL,
  "progress_id" INTEGER,
  "event_type" certification_review_event_type_enum NOT NULL,
  "comment" TEXT,
  "performed_by_id" UUID NOT NULL,
  "from_status" VARCHAR(64),
  "to_status" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "certification_review_events_enrollment_id_fkey"
    FOREIGN KEY ("enrollment_id") REFERENCES "users_certifications"("enrollment_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "certification_review_events_progress_id_fkey"
    FOREIGN KEY ("progress_id") REFERENCES "certification_section_progress"("progress_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "certification_review_events_performed_by_id_fkey"
    FOREIGN KEY ("performed_by_id") REFERENCES "users"("user_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_cert_review_events_enrollment"
  ON "certification_review_events"("enrollment_id", "created_at");

CREATE INDEX IF NOT EXISTS "idx_cert_review_events_progress"
  ON "certification_review_events"("progress_id", "created_at");

CREATE TABLE IF NOT EXISTS "certification_closeout_evidences" (
  "closeout_evidence_id" SERIAL PRIMARY KEY,
  "enrollment_id" INTEGER NOT NULL,
  "object_key" VARCHAR(512) NOT NULL,
  "original_filename" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "checksum_sha256" CHAR(64),
  "upload_status" certification_evidence_upload_status_enum NOT NULL DEFAULT 'PENDING_UPLOAD',
  "review_status" certification_closeout_review_status_enum NOT NULL DEFAULT 'PENDING',
  "uploaded_by_id" UUID NOT NULL,
  "reviewed_by_id" UUID,
  "confirmed_at" TIMESTAMPTZ(6),
  "reviewed_at" TIMESTAMPTZ(6),
  "review_comment" TEXT,
  "deleted_at" TIMESTAMPTZ(6),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "certification_closeout_evidences_enrollment_id_fkey"
    FOREIGN KEY ("enrollment_id") REFERENCES "users_certifications"("enrollment_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "certification_closeout_evidences_uploaded_by_id_fkey"
    FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("user_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "certification_closeout_evidences_reviewed_by_id_fkey"
    FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("user_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_cert_closeout_evidences_enrollment"
  ON "certification_closeout_evidences"("enrollment_id");

CREATE INDEX IF NOT EXISTS "idx_cert_closeout_evidences_review_status"
  ON "certification_closeout_evidences"("review_status");

-- Prevent structural edits of published/retired versions at DB layer (status transitions still allowed).
CREATE OR REPLACE FUNCTION prevent_immutable_certification_version_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('PUBLISHED', 'RETIRED') THEN
    IF NEW.status IS DISTINCT FROM OLD.status
      OR NEW.retired_at IS DISTINCT FROM OLD.retired_at
      OR NEW.active IS DISTINCT FROM OLD.active
      OR NEW.modified_at IS DISTINCT FROM OLD.modified_at THEN
      IF NEW.version_number IS DISTINCT FROM OLD.version_number
        OR NEW.certification_id IS DISTINCT FROM OLD.certification_id
        OR NEW.title IS DISTINCT FROM OLD.title
        OR NEW.description IS DISTINCT FROM OLD.description
        OR NEW.min_duration_months IS DISTINCT FROM OLD.min_duration_months
        OR NEW.max_duration_months IS DISTINCT FROM OLD.max_duration_months
        OR NEW.published_at IS DISTINCT FROM OLD.published_at
        OR NEW.published_by_id IS DISTINCT FROM OLD.published_by_id THEN
        RAISE EXCEPTION 'CERT_VERSION_IMMUTABLE';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'CERT_VERSION_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_certification_versions_immutable ON "certification_versions";
CREATE TRIGGER trg_certification_versions_immutable
  BEFORE UPDATE ON "certification_versions"
  FOR EACH ROW
  EXECUTE FUNCTION prevent_immutable_certification_version_mutation();
