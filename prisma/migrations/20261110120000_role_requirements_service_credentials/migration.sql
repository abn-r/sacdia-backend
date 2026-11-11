-- Constancia de consejería de los cargos de servicio (F5, modo INFO).
--
-- role_requirements: qué rol exige qué constancia, en qué modo (INFO/WARN/BLOCK)
-- y desde cuándo. Activarlo es un cambio de datos (UPDATE ... SET mode, effective_from).
-- service_credentials: la constancia subida por la persona; la revisión es F6.
--
-- Plain DDL, idempotent seed. No CONCURRENTLY.

CREATE TYPE "role_requirement_type_enum" AS ENUM ('COUNSELOR_TRAINING');
CREATE TYPE "role_requirement_mode_enum" AS ENUM ('INFO', 'WARN', 'BLOCK');
CREATE TYPE "service_credential_status_enum" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');
CREATE TYPE "service_credential_upload_status_enum" AS ENUM ('PENDING_UPLOAD', 'CONFIRMED');

CREATE TABLE "role_requirements" (
  "requirement_id" SERIAL NOT NULL,
  "role_id" UUID NOT NULL,
  "club_type_id" INTEGER,
  "requirement_type" "role_requirement_type_enum" NOT NULL,
  "mode" "role_requirement_mode_enum" NOT NULL DEFAULT 'INFO',
  "effective_from" DATE,
  "equivalent_certification_id" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "role_requirements_pkey" PRIMARY KEY ("requirement_id")
);

CREATE TABLE "service_credentials" (
  "credential_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "credential_type" "role_requirement_type_enum" NOT NULL,
  "completed_at" DATE,
  "object_key" VARCHAR(512),
  "original_filename" VARCHAR(255),
  "mime_type" VARCHAR(100),
  "size_bytes" BIGINT,
  "upload_status" "service_credential_upload_status_enum" NOT NULL,
  "status" "service_credential_status_enum" NOT NULL DEFAULT 'PENDING_REVIEW',
  "reviewed_by_id" UUID,
  "reviewer_role" VARCHAR(50),
  "reviewed_at" TIMESTAMPTZ(6),
  "decision_reason" TEXT,
  "expires_at" DATE,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_credentials_pkey" PRIMARY KEY ("credential_id")
);

ALTER TABLE "role_requirements"
  ADD CONSTRAINT "role_requirements_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("role_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "role_requirements"
  ADD CONSTRAINT "role_requirements_club_type_id_fkey"
  FOREIGN KEY ("club_type_id") REFERENCES "club_types"("club_type_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "role_requirements"
  ADD CONSTRAINT "role_requirements_equivalent_certification_id_fkey"
  FOREIGN KEY ("equivalent_certification_id") REFERENCES "certifications"("certification_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "service_credentials"
  ADD CONSTRAINT "service_credentials_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "service_credentials"
  ADD CONSTRAINT "service_credentials_reviewed_by_id_fkey"
  FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE INDEX "idx_role_requirements_role_active"
  ON "role_requirements" ("role_id", "active");

-- One active requirement per role, type and club type (NULL club type = all).
CREATE UNIQUE INDEX "uq_role_requirements_active"
  ON "role_requirements" ("role_id", "requirement_type", (COALESCE("club_type_id", 0)))
  WHERE "active";

CREATE INDEX "idx_service_credentials_user_type_status"
  ON "service_credentials" ("user_id", "credential_type", "status");

-- Seed: the six service roles, informational only (mode INFO, no effective date).
INSERT INTO "role_requirements" ("role_id", "club_type_id", "requirement_type", "mode", "effective_from", "active")
SELECT r."role_id", NULL, 'COUNSELOR_TRAINING'::"role_requirement_type_enum", 'INFO'::"role_requirement_mode_enum", NULL, true
FROM "roles" r
WHERE r."role_category" = 'CLUB'
  AND r."role_name" IN ('director', 'deputy-director', 'secretary', 'treasurer', 'secretary-treasurer', 'counselor')
ON CONFLICT DO NOTHING;
