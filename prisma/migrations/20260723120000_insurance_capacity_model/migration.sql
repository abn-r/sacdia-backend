-- Capacity-oriented insurance ledger.
-- This migration is additive: legacy member_insurances and camporee_members
-- remain unchanged while the new purchase/slot model is introduced.

CREATE TYPE "insurance_coverage_scope_enum" AS ENUM ('GENERAL', 'EVENT');
CREATE TYPE "insurance_validity_mode_enum" AS ENUM ('FIXED_MONTHS', 'EVENT_DATES');
CREATE TYPE "insurance_purchase_status_enum" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED', 'REVERSED');
CREATE TYPE "insurance_purchase_classification_enum" AS ENUM ('ORDINARY', 'EXTRAORDINARY', 'LEGACY_UNCLASSIFIED');
CREATE TYPE "insurance_slot_status_enum" AS ENUM ('AVAILABLE', 'ASSIGNED', 'VOID');
CREATE TYPE "insurance_slot_movement_type_enum" AS ENUM ('PURCHASE_CONFIRMED', 'TRANSFERRED', 'ASSIGNED', 'RELEASED', 'REASSIGNED', 'VOIDED', 'CORRECTED');
CREATE TYPE "insurance_assignment_subject_enum" AS ENUM ('MEMBER', 'EVENT_EXTERNAL');
CREATE TYPE "insurance_assignment_status_enum" AS ENUM ('PENDING_CONFIRMATION', 'ACTIVE', 'REJECTED', 'RELEASED', 'EXPIRED');
CREATE TYPE "insurance_evidence_type_enum" AS ENUM ('PURCHASE_PROOF', 'INDIVIDUAL_RECEIPT');

CREATE TABLE "insurance_products" (
  "insurance_product_id" SERIAL NOT NULL,
  "local_field_id" INTEGER NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "coverage_scope" "insurance_coverage_scope_enum" NOT NULL,
  "validity_mode" "insurance_validity_mode_enum" NOT NULL,
  "default_duration_months" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID,
  "modified_by_id" UUID,
  CONSTRAINT "insurance_products_pkey" PRIMARY KEY ("insurance_product_id"),
  CONSTRAINT "insurance_products_local_field_id_fkey" FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_products_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "insurance_products_modified_by_id_fkey" FOREIGN KEY ("modified_by_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE TABLE "insurance_cycle_configs" (
  "insurance_cycle_config_id" SERIAL NOT NULL,
  "insurance_product_id" INTEGER NOT NULL,
  "local_field_id" INTEGER NOT NULL,
  "ecclesiastical_year_id" INTEGER NOT NULL,
  "club_type_id" INTEGER NOT NULL,
  "unit_cost" DECIMAL(10, 2) NOT NULL,
  "purchase_deadline" DATE NOT NULL,
  "timezone" VARCHAR(64) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID,
  "modified_by_id" UUID,
  CONSTRAINT "insurance_cycle_configs_pkey" PRIMARY KEY ("insurance_cycle_config_id"),
  CONSTRAINT "uq_insurance_cycle_config_effective_scope" UNIQUE ("insurance_product_id", "local_field_id", "ecclesiastical_year_id", "club_type_id"),
  CONSTRAINT "insurance_cycle_configs_unit_cost_positive_check" CHECK ("unit_cost" > 0),
  CONSTRAINT "insurance_cycle_configs_product_id_fkey" FOREIGN KEY ("insurance_product_id") REFERENCES "insurance_products"("insurance_product_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_cycle_configs_local_field_id_fkey" FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_cycle_configs_year_id_fkey" FOREIGN KEY ("ecclesiastical_year_id") REFERENCES "ecclesiastical_years"("year_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_cycle_configs_club_type_id_fkey" FOREIGN KEY ("club_type_id") REFERENCES "club_types"("club_type_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_cycle_configs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "insurance_cycle_configs_modified_by_id_fkey" FOREIGN KEY ("modified_by_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE TABLE "camporee_external_participants" (
  "camporee_external_participant_id" SERIAL NOT NULL,
  "local_camporee_id" INTEGER,
  "union_camporee_id" INTEGER,
  "full_name" VARCHAR(255) NOT NULL,
  "role_type" VARCHAR(50) NOT NULL,
  "role_description" VARCHAR(500),
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID,
  "modified_by_id" UUID,
  CONSTRAINT "camporee_external_participants_pkey" PRIMARY KEY ("camporee_external_participant_id"),
  CONSTRAINT "camporee_external_participants_event_xor_check" CHECK (
    ("local_camporee_id" IS NOT NULL AND "union_camporee_id" IS NULL)
    OR ("local_camporee_id" IS NULL AND "union_camporee_id" IS NOT NULL)
  ),
  CONSTRAINT "camporee_external_participants_local_camporee_id_fkey" FOREIGN KEY ("local_camporee_id") REFERENCES "local_camporees"("local_camporee_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "camporee_external_participants_union_camporee_id_fkey" FOREIGN KEY ("union_camporee_id") REFERENCES "union_camporees"("union_camporee_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "camporee_external_participants_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "camporee_external_participants_modified_by_id_fkey" FOREIGN KEY ("modified_by_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE TABLE "insurance_purchases" (
  "insurance_purchase_id" SERIAL NOT NULL,
  "insurance_cycle_config_id" INTEGER NOT NULL,
  "owner_club_id" INTEGER NOT NULL,
  "purchasing_section_id" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_cost_snapshot" DECIMAL(10, 2),
  "total_amount" DECIMAL(12, 2),
  "external_reference" VARCHAR(255),
  "receipt_date" DATE,
  "applied_deadline" DATE,
  "classification" "insurance_purchase_classification_enum",
  "status" "insurance_purchase_status_enum" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  "submitted_by_id" UUID NOT NULL,
  "reviewed_by_id" UUID,
  "reviewed_at" TIMESTAMPTZ(6),
  "rejection_reason" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID,
  "modified_by_id" UUID,
  CONSTRAINT "insurance_purchases_pkey" PRIMARY KEY ("insurance_purchase_id"),
  CONSTRAINT "insurance_purchases_confirmed_provenance_check" CHECK (
    "status" NOT IN ('CONFIRMED', 'REVERSED') OR (
      "owner_club_id" IS NOT NULL
      AND "purchasing_section_id" IS NOT NULL
      AND "unit_cost_snapshot" IS NOT NULL
      AND "total_amount" IS NOT NULL
      AND "external_reference" IS NOT NULL
      AND BTRIM("external_reference") <> ''
      AND "receipt_date" IS NOT NULL
      AND "applied_deadline" IS NOT NULL
      AND "classification" IS NOT NULL
    )
  ),
  CONSTRAINT "insurance_purchases_quantity_positive_check" CHECK ("quantity" > 0),
  CONSTRAINT "insurance_purchases_unit_cost_snapshot_positive_check" CHECK ("unit_cost_snapshot" IS NULL OR "unit_cost_snapshot" > 0),
  CONSTRAINT "insurance_purchases_total_amount_positive_check" CHECK ("total_amount" IS NULL OR "total_amount" > 0),
  CONSTRAINT "insurance_purchases_cycle_config_id_fkey" FOREIGN KEY ("insurance_cycle_config_id") REFERENCES "insurance_cycle_configs"("insurance_cycle_config_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_purchases_owner_club_id_fkey" FOREIGN KEY ("owner_club_id") REFERENCES "clubs"("club_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_purchases_purchasing_section_id_fkey" FOREIGN KEY ("purchasing_section_id") REFERENCES "club_sections"("club_section_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_purchases_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_purchases_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "insurance_purchases_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "insurance_purchases_modified_by_id_fkey" FOREIGN KEY ("modified_by_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE TABLE "insurance_coverage_slots" (
  "insurance_coverage_slot_id" SERIAL NOT NULL,
  "insurance_purchase_id" INTEGER NOT NULL,
  "sequence_number" INTEGER NOT NULL,
  "owner_club_id" INTEGER NOT NULL,
  "purchasing_section_id" INTEGER NOT NULL,
  "current_section_id" INTEGER NOT NULL,
  "status" "insurance_slot_status_enum" NOT NULL DEFAULT 'AVAILABLE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID,
  "modified_by_id" UUID,
  CONSTRAINT "insurance_coverage_slots_pkey" PRIMARY KEY ("insurance_coverage_slot_id"),
  CONSTRAINT "uq_insurance_slot_purchase_sequence" UNIQUE ("insurance_purchase_id", "sequence_number"),
  CONSTRAINT "insurance_coverage_slots_purchase_id_fkey" FOREIGN KEY ("insurance_purchase_id") REFERENCES "insurance_purchases"("insurance_purchase_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_coverage_slots_owner_club_id_fkey" FOREIGN KEY ("owner_club_id") REFERENCES "clubs"("club_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_coverage_slots_purchasing_section_id_fkey" FOREIGN KEY ("purchasing_section_id") REFERENCES "club_sections"("club_section_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_coverage_slots_current_section_id_fkey" FOREIGN KEY ("current_section_id") REFERENCES "club_sections"("club_section_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_coverage_slots_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "insurance_coverage_slots_modified_by_id_fkey" FOREIGN KEY ("modified_by_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE TABLE "insurance_assignments" (
  "insurance_assignment_id" SERIAL NOT NULL,
  "insurance_coverage_slot_id" INTEGER NOT NULL,
  "subject_type" "insurance_assignment_subject_enum" NOT NULL,
  "user_id" UUID,
  "event_external_participant_id" INTEGER,
  "valid_from" DATE NOT NULL,
  "valid_until" DATE NOT NULL,
  "status" "insurance_assignment_status_enum" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  "release_reason" TEXT,
  "assigned_by_id" UUID NOT NULL,
  "confirmed_by_id" UUID,
  "confirmed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID,
  "modified_by_id" UUID,
  CONSTRAINT "insurance_assignments_pkey" PRIMARY KEY ("insurance_assignment_id"),
  CONSTRAINT "insurance_assignments_subject_xor_check" CHECK (
    ("subject_type" = 'MEMBER' AND "user_id" IS NOT NULL AND "event_external_participant_id" IS NULL)
    OR ("subject_type" = 'EVENT_EXTERNAL' AND "user_id" IS NULL AND "event_external_participant_id" IS NOT NULL)
  ),
  CONSTRAINT "insurance_assignments_validity_range_check" CHECK ("valid_until" >= "valid_from"),
  CONSTRAINT "insurance_assignments_slot_id_fkey" FOREIGN KEY ("insurance_coverage_slot_id") REFERENCES "insurance_coverage_slots"("insurance_coverage_slot_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_assignments_external_participant_id_fkey" FOREIGN KEY ("event_external_participant_id") REFERENCES "camporee_external_participants"("camporee_external_participant_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_assignments_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "insurance_assignments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "insurance_assignments_modified_by_id_fkey" FOREIGN KEY ("modified_by_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE TABLE "insurance_slot_movements" (
  "insurance_slot_movement_id" SERIAL NOT NULL,
  "insurance_coverage_slot_id" INTEGER NOT NULL,
  "movement_type" "insurance_slot_movement_type_enum" NOT NULL,
  "from_section_id" INTEGER,
  "to_section_id" INTEGER,
  "insurance_assignment_id" INTEGER,
  "reason" TEXT,
  "performed_by_id" UUID NOT NULL,
  "correlation_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "insurance_slot_movements_pkey" PRIMARY KEY ("insurance_slot_movement_id"),
  CONSTRAINT "insurance_slot_movements_slot_id_fkey" FOREIGN KEY ("insurance_coverage_slot_id") REFERENCES "insurance_coverage_slots"("insurance_coverage_slot_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_slot_movements_from_section_id_fkey" FOREIGN KEY ("from_section_id") REFERENCES "club_sections"("club_section_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_slot_movements_to_section_id_fkey" FOREIGN KEY ("to_section_id") REFERENCES "club_sections"("club_section_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_slot_movements_assignment_id_fkey" FOREIGN KEY ("insurance_assignment_id") REFERENCES "insurance_assignments"("insurance_assignment_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_slot_movements_performed_by_id_fkey" FOREIGN KEY ("performed_by_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE "insurance_evidence_files" (
  "insurance_evidence_file_id" SERIAL NOT NULL,
  "insurance_purchase_id" INTEGER,
  "insurance_assignment_id" INTEGER,
  "evidence_type" "insurance_evidence_type_enum" NOT NULL,
  "file_key" VARCHAR(500) NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "file_size" INTEGER NOT NULL,
  "external_reference" VARCHAR(255),
  "receipt_date" DATE,
  "uploaded_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID,
  "modified_by_id" UUID,
  CONSTRAINT "insurance_evidence_files_pkey" PRIMARY KEY ("insurance_evidence_file_id"),
  CONSTRAINT "insurance_evidence_files_owner_xor_check" CHECK (
    ("insurance_purchase_id" IS NOT NULL AND "insurance_assignment_id" IS NULL)
    OR ("insurance_purchase_id" IS NULL AND "insurance_assignment_id" IS NOT NULL)
  ),
  CONSTRAINT "insurance_evidence_files_type_owner_check" CHECK (
    ("evidence_type" = 'PURCHASE_PROOF' AND "insurance_purchase_id" IS NOT NULL AND "insurance_assignment_id" IS NULL)
    OR ("evidence_type" = 'INDIVIDUAL_RECEIPT' AND "insurance_purchase_id" IS NULL AND "insurance_assignment_id" IS NOT NULL)
  ),
  CONSTRAINT "insurance_evidence_files_purchase_id_fkey" FOREIGN KEY ("insurance_purchase_id") REFERENCES "insurance_purchases"("insurance_purchase_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_evidence_files_assignment_id_fkey" FOREIGN KEY ("insurance_assignment_id") REFERENCES "insurance_assignments"("insurance_assignment_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_evidence_files_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("user_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "insurance_evidence_files_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "insurance_evidence_files_modified_by_id_fkey" FOREIGN KEY ("modified_by_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX "idx_insurance_products_local_field_active"
  ON "insurance_products"("local_field_id", "active");

CREATE INDEX "idx_insurance_purchases_section_receipt_status"
  ON "insurance_purchases"("purchasing_section_id", "receipt_date", "status");

CREATE INDEX "idx_insurance_slots_current_section_status"
  ON "insurance_coverage_slots"("current_section_id", "status");

CREATE INDEX "idx_insurance_slot_movements_slot_created"
  ON "insurance_slot_movements"("insurance_coverage_slot_id", "created_at");

CREATE INDEX "idx_insurance_assignments_user_status_until"
  ON "insurance_assignments"("user_id", "status", "valid_until");

CREATE INDEX "idx_camporee_external_participants_local_active"
  ON "camporee_external_participants"("local_camporee_id", "active");

CREATE INDEX "idx_camporee_external_participants_union_active"
  ON "camporee_external_participants"("union_camporee_id", "active");

-- Prisma cannot represent this partial unique index. It protects the slot
-- allocation invariant under concurrent assignment attempts.
CREATE UNIQUE INDEX "uq_insurance_assignment_active_slot"
  ON "insurance_assignments"("insurance_coverage_slot_id")
  WHERE "status" IN ('PENDING_CONFIRMATION', 'ACTIVE');

-- The ORM cannot express cross-table ownership invariants. Keep them in the
-- database so imports, scripts, and concurrent writers cannot bypass them.
CREATE FUNCTION "validate_insurance_cycle_config_local_field"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  product_local_field_id INTEGER;
BEGIN
  SELECT "local_field_id"
    INTO product_local_field_id
    FROM "insurance_products"
   WHERE "insurance_product_id" = NEW."insurance_product_id";

  IF product_local_field_id IS DISTINCT FROM NEW."local_field_id" THEN
    RAISE EXCEPTION
      'insurance cycle configuration local field must match its product local field';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "insurance_cycle_configs_validate_product_local_field"
BEFORE INSERT OR UPDATE OF "insurance_product_id", "local_field_id"
ON "insurance_cycle_configs"
FOR EACH ROW
EXECUTE FUNCTION "validate_insurance_cycle_config_local_field"();

CREATE FUNCTION "prevent_insurance_product_local_field_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."local_field_id" IS DISTINCT FROM NEW."local_field_id"
     AND EXISTS (
       SELECT 1
         FROM "insurance_cycle_configs"
        WHERE "insurance_product_id" = OLD."insurance_product_id"
     ) THEN
    RAISE EXCEPTION
      'insurance product local field is immutable once cycle configurations exist';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "insurance_products_prevent_local_field_mutation"
BEFORE UPDATE OF "local_field_id"
ON "insurance_products"
FOR EACH ROW
EXECUTE FUNCTION "prevent_insurance_product_local_field_mutation"();

CREATE FUNCTION "prevent_insurance_section_owner_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."main_club_id" IS DISTINCT FROM NEW."main_club_id"
     AND (
       EXISTS (
         SELECT 1
           FROM "insurance_purchases"
          WHERE "purchasing_section_id" = OLD."club_section_id"
       )
       OR EXISTS (
         SELECT 1
           FROM "insurance_coverage_slots"
          WHERE "purchasing_section_id" = OLD."club_section_id"
             OR "current_section_id" = OLD."club_section_id"
       )
     ) THEN
    RAISE EXCEPTION
      'club section owner is immutable while insurance purchases or slots depend on it';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "club_sections_prevent_insurance_owner_mutation"
BEFORE UPDATE OF "main_club_id"
ON "club_sections"
FOR EACH ROW
EXECUTE FUNCTION "prevent_insurance_section_owner_mutation"();

CREATE FUNCTION "validate_insurance_purchase_section_owner"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  section_owner_club_id INTEGER;
BEGIN
  SELECT "main_club_id"
    INTO section_owner_club_id
    FROM "club_sections"
   WHERE "club_section_id" = NEW."purchasing_section_id";

  IF section_owner_club_id IS DISTINCT FROM NEW."owner_club_id" THEN
    RAISE EXCEPTION
      'insurance purchase purchasing section must belong to its owner club';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "insurance_purchases_validate_section_owner"
BEFORE INSERT OR UPDATE OF "owner_club_id", "purchasing_section_id"
ON "insurance_purchases"
FOR EACH ROW
EXECUTE FUNCTION "validate_insurance_purchase_section_owner"();

CREATE FUNCTION "prevent_insurance_purchase_provenance_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" IN ('CONFIRMED', 'REVERSED')
     AND (
       OLD."insurance_cycle_config_id" IS DISTINCT FROM NEW."insurance_cycle_config_id"
       OR OLD."owner_club_id" IS DISTINCT FROM NEW."owner_club_id"
       OR OLD."purchasing_section_id" IS DISTINCT FROM NEW."purchasing_section_id"
       OR OLD."quantity" IS DISTINCT FROM NEW."quantity"
       OR OLD."unit_cost_snapshot" IS DISTINCT FROM NEW."unit_cost_snapshot"
       OR OLD."total_amount" IS DISTINCT FROM NEW."total_amount"
       OR OLD."external_reference" IS DISTINCT FROM NEW."external_reference"
       OR OLD."receipt_date" IS DISTINCT FROM NEW."receipt_date"
       OR OLD."applied_deadline" IS DISTINCT FROM NEW."applied_deadline"
       OR OLD."classification" IS DISTINCT FROM NEW."classification"
     ) THEN
    RAISE EXCEPTION
      'approved insurance purchase provenance and snapshots are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "insurance_purchases_prevent_provenance_mutation"
BEFORE UPDATE ON "insurance_purchases"
FOR EACH ROW
EXECUTE FUNCTION "prevent_insurance_purchase_provenance_mutation"();

CREATE FUNCTION "validate_insurance_coverage_slot_context"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  purchase_owner_club_id INTEGER;
  purchase_section_id INTEGER;
  purchase_status "insurance_purchase_status_enum";
  purchasing_section_owner_club_id INTEGER;
  current_section_owner_club_id INTEGER;
BEGIN
  SELECT "owner_club_id", "purchasing_section_id", "status"
    INTO purchase_owner_club_id, purchase_section_id, purchase_status
    FROM "insurance_purchases"
   WHERE "insurance_purchase_id" = NEW."insurance_purchase_id";

  IF purchase_status IS DISTINCT FROM 'CONFIRMED'::"insurance_purchase_status_enum" THEN
    RAISE EXCEPTION
      'insurance coverage slots can only be created or updated from confirmed purchases';
  END IF;

  IF purchase_owner_club_id IS DISTINCT FROM NEW."owner_club_id"
     OR purchase_section_id IS DISTINCT FROM NEW."purchasing_section_id" THEN
    RAISE EXCEPTION
      'insurance coverage slot owner and purchasing section must match its purchase';
  END IF;

  SELECT "main_club_id"
    INTO purchasing_section_owner_club_id
    FROM "club_sections"
   WHERE "club_section_id" = NEW."purchasing_section_id";

  IF purchasing_section_owner_club_id IS DISTINCT FROM NEW."owner_club_id" THEN
    RAISE EXCEPTION
      'insurance coverage slot purchasing section must belong to its owner club';
  END IF;

  SELECT "main_club_id"
    INTO current_section_owner_club_id
    FROM "club_sections"
   WHERE "club_section_id" = NEW."current_section_id";

  IF current_section_owner_club_id IS DISTINCT FROM NEW."owner_club_id" THEN
    RAISE EXCEPTION
      'insurance coverage slot current custody section must belong to its owner club';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "insurance_coverage_slots_validate_context"
BEFORE INSERT OR UPDATE OF "insurance_purchase_id", "owner_club_id", "purchasing_section_id", "current_section_id"
ON "insurance_coverage_slots"
FOR EACH ROW
EXECUTE FUNCTION "validate_insurance_coverage_slot_context"();

CREATE FUNCTION "prevent_insurance_coverage_slot_provenance_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."insurance_purchase_id" IS DISTINCT FROM NEW."insurance_purchase_id"
     OR OLD."owner_club_id" IS DISTINCT FROM NEW."owner_club_id"
     OR OLD."purchasing_section_id" IS DISTINCT FROM NEW."purchasing_section_id" THEN
    RAISE EXCEPTION
      'insurance coverage slot purchase, owner, and purchasing section are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "insurance_coverage_slots_prevent_provenance_mutation"
BEFORE UPDATE OF "insurance_purchase_id", "owner_club_id", "purchasing_section_id"
ON "insurance_coverage_slots"
FOR EACH ROW
EXECUTE FUNCTION "prevent_insurance_coverage_slot_provenance_mutation"();

CREATE FUNCTION "prevent_insurance_slot_movement_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'insurance slot movements are immutable and cannot be updated or deleted';

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "insurance_slot_movements_prevent_mutation"
BEFORE UPDATE OR DELETE
ON "insurance_slot_movements"
FOR EACH ROW
EXECUTE FUNCTION "prevent_insurance_slot_movement_mutation"();
