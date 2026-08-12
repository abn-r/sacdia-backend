-- Field payment orders kernel: órdenes de pago territoriales (seguros + camporees).
-- Plan: docs/plans/2026-08-05-insurance-camporee-payment-orders-plan.md (+ addendum 2026-08-12).

DO $$ BEGIN
    CREATE TYPE "field_payment_order_purpose_enum" AS ENUM ('INSURANCE', 'CAMPOREE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "field_payment_order_status_enum" AS ENUM
        ('ISSUED', 'PROOF_SUBMITTED', 'APPROVED', 'PROOF_REJECTED', 'CANCELLED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "field_payment_order_proof_status_enum" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "insurance_reassignment_request_status_enum" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "field_payment_orders" (
    "field_payment_order_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purpose" "field_payment_order_purpose_enum" NOT NULL,
    "local_field_id" INTEGER NOT NULL,
    "club_id" INTEGER NOT NULL,
    "club_section_id" INTEGER NOT NULL,
    "folio" INTEGER NOT NULL,
    "folio_reference" VARCHAR(16) NOT NULL,
    "insurance_cycle_config_id" INTEGER,
    "local_camporee_id" INTEGER,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
    "unit_cost_centavos" INTEGER NOT NULL,
    "total_centavos" INTEGER NOT NULL,
    "status" "field_payment_order_status_enum" NOT NULL DEFAULT 'ISSUED',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "issued_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "cancelled_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "expired_at" TIMESTAMPTZ(6),
    "idempotency_key" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_payment_orders_pkey" PRIMARY KEY ("field_payment_order_id"),
    CONSTRAINT "field_payment_orders_local_field_id_fkey"
        FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "field_payment_orders_club_id_fkey"
        FOREIGN KEY ("club_id") REFERENCES "clubs"("club_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "field_payment_orders_club_section_id_fkey"
        FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "field_payment_orders_insurance_cycle_config_id_fkey"
        FOREIGN KEY ("insurance_cycle_config_id") REFERENCES "insurance_cycle_configs"("insurance_cycle_config_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "field_payment_orders_local_camporee_id_fkey"
        FOREIGN KEY ("local_camporee_id") REFERENCES "local_camporees"("local_camporee_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "field_payment_orders_issued_by_id_fkey"
        FOREIGN KEY ("issued_by_id") REFERENCES "users"("user_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "field_payment_orders_approved_by_id_fkey"
        FOREIGN KEY ("approved_by_id") REFERENCES "users"("user_id")
        ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "field_payment_orders_cancelled_by_id_fkey"
        FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("user_id")
        ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "field_payment_orders_amounts_check"
        CHECK ("unit_cost_centavos" > 0 AND "total_centavos" > 0),
    CONSTRAINT "field_payment_orders_purpose_ref_check"
        CHECK (
            ("purpose" = 'INSURANCE' AND "insurance_cycle_config_id" IS NOT NULL AND "local_camporee_id" IS NULL)
            OR ("purpose" = 'CAMPOREE' AND "local_camporee_id" IS NOT NULL AND "insurance_cycle_config_id" IS NULL)
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_field_payment_orders_lf_folio"
    ON "field_payment_orders"("local_field_id", "folio_reference");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_field_payment_orders_idempotency"
    ON "field_payment_orders"("issued_by_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_field_payment_orders_lf_status"
    ON "field_payment_orders"("local_field_id", "status");
CREATE INDEX IF NOT EXISTS "idx_field_payment_orders_section_status"
    ON "field_payment_orders"("club_section_id", "status");

CREATE TABLE IF NOT EXISTS "field_payment_order_lines" (
    "field_payment_order_line_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "field_payment_order_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "beneficiary_user_id" UUID NOT NULL,
    "unit_cost_centavos" INTEGER NOT NULL,
    "purpose" "field_payment_order_purpose_enum" NOT NULL,
    "purpose_ref_id" INTEGER NOT NULL,
    "active_guard" BOOLEAN NOT NULL DEFAULT true,
    "purpose_payload" JSONB,
    "insurance_assignment_id" INTEGER,
    "camporee_member_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_payment_order_lines_pkey" PRIMARY KEY ("field_payment_order_line_id"),
    CONSTRAINT "field_payment_order_lines_order_fkey"
        FOREIGN KEY ("field_payment_order_id") REFERENCES "field_payment_orders"("field_payment_order_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "field_payment_order_lines_beneficiary_fkey"
        FOREIGN KEY ("beneficiary_user_id") REFERENCES "users"("user_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "field_payment_order_lines_assignment_fkey"
        FOREIGN KEY ("insurance_assignment_id") REFERENCES "insurance_assignments"("insurance_assignment_id")
        ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "field_payment_order_lines_camporee_member_fkey"
        FOREIGN KEY ("camporee_member_id") REFERENCES "camporee_members"("camporee_member_id")
        ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "field_payment_order_lines_unit_cost_check"
        CHECK ("unit_cost_centavos" > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_field_payment_order_lines_sequence"
    ON "field_payment_order_lines"("field_payment_order_id", "sequence");
CREATE INDEX IF NOT EXISTS "idx_field_payment_order_lines_beneficiary"
    ON "field_payment_order_lines"("beneficiary_user_id");

-- Invariante: un beneficiario no puede estar en dos órdenes vivas (ISSUED /
-- PROOF_SUBMITTED / PROOF_REJECTED / APPROVED) del mismo propósito+referencia.
-- El servicio libera active_guard al cancelar/expirar la orden.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_field_payment_order_lines_active_beneficiary"
    ON "field_payment_order_lines"("beneficiary_user_id", "purpose", "purpose_ref_id")
    WHERE "active_guard";

CREATE TABLE IF NOT EXISTS "field_payment_order_proofs" (
    "field_payment_order_proof_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "field_payment_order_id" UUID NOT NULL,
    "r2_key" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "field_payment_order_proof_status_enum" NOT NULL DEFAULT 'SUBMITTED',
    "reject_reason" TEXT,
    "uploaded_by_id" UUID NOT NULL,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_payment_order_proofs_pkey" PRIMARY KEY ("field_payment_order_proof_id"),
    CONSTRAINT "field_payment_order_proofs_order_fkey"
        FOREIGN KEY ("field_payment_order_id") REFERENCES "field_payment_orders"("field_payment_order_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "field_payment_order_proofs_uploaded_by_fkey"
        FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("user_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "field_payment_order_proofs_reviewed_by_fkey"
        FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("user_id")
        ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_field_payment_order_proofs_order_status"
    ON "field_payment_order_proofs"("field_payment_order_id", "status");

CREATE TABLE IF NOT EXISTS "field_payment_folio_counters" (
    "local_field_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "last_folio" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_payment_folio_counters_pkey" PRIMARY KEY ("local_field_id", "year"),
    CONSTRAINT "field_payment_folio_counters_local_field_fkey"
        FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS "field_payment_order_configs" (
    "field_payment_order_config_id" SERIAL NOT NULL,
    "local_field_id" INTEGER NOT NULL,
    "bank_name" VARCHAR(255),
    "bank_account" VARCHAR(64),
    "bank_clabe" VARCHAR(32),
    "bank_holder" VARCHAR(255),
    "cash_instructions" TEXT,
    "extra_notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "modified_by_id" UUID,

    CONSTRAINT "field_payment_order_configs_pkey" PRIMARY KEY ("field_payment_order_config_id"),
    CONSTRAINT "field_payment_order_configs_local_field_fkey"
        FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "field_payment_order_configs_local_field_id_key"
    ON "field_payment_order_configs"("local_field_id");

CREATE TABLE IF NOT EXISTS "insurance_reassignment_requests" (
    "insurance_reassignment_request_id" SERIAL NOT NULL,
    "insurance_assignment_id" INTEGER NOT NULL,
    "from_user_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "reason" TEXT,
    "status" "insurance_reassignment_request_status_enum" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" UUID NOT NULL,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_reassignment_requests_pkey" PRIMARY KEY ("insurance_reassignment_request_id"),
    CONSTRAINT "insurance_reassignment_requests_assignment_fkey"
        FOREIGN KEY ("insurance_assignment_id") REFERENCES "insurance_assignments"("insurance_assignment_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "insurance_reassignment_requests_from_user_fkey"
        FOREIGN KEY ("from_user_id") REFERENCES "users"("user_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "insurance_reassignment_requests_to_user_fkey"
        FOREIGN KEY ("to_user_id") REFERENCES "users"("user_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "insurance_reassignment_requests_requested_by_fkey"
        FOREIGN KEY ("requested_by_id") REFERENCES "users"("user_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "insurance_reassignment_requests_reviewed_by_fkey"
        FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("user_id")
        ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_insurance_reassignment_requests_status"
    ON "insurance_reassignment_requests"("status", "created_at");
CREATE INDEX IF NOT EXISTS "idx_insurance_reassignment_requests_assignment"
    ON "insurance_reassignment_requests"("insurance_assignment_id");

-- Solo una solicitud de reasignación pendiente por assignment.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_insurance_reassignment_requests_pending"
    ON "insurance_reassignment_requests"("insurance_assignment_id")
    WHERE "status" = 'PENDING';

-- Config keys del rollout (idempotente; el flag arranca sin LFs habilitados).
INSERT INTO "system_config" ("config_key", "config_value", "description", "config_type")
VALUES
    ('field_payment_orders_v1', '[]',
     'Lista JSON de local_field_id habilitados para el flujo de órdenes de pago territoriales', 'json'),
    ('field_payment_orders.expiry_days', '15',
     'Días para expirar órdenes de pago ISSUED sin comprobante', 'number')
ON CONFLICT ("config_key") DO NOTHING;
