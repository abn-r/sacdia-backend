-- Insumos de camporee: plan por sección, slots del organizador, folio INS.
-- Plan: docs/plans/2026-08-26-camporee-supplies.md
-- Un plan por (sección, camporee). Folio propio INS{yyyy}{####}, no PED.

DO $$ BEGIN
    CREATE TYPE "camporee_supply_uom_enum" AS ENUM ('KG', 'L', 'BAG', 'UNIT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "camporee_supply_plan_status_enum" AS ENUM ('DRAFT', 'SUBMITTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "camporee_supply_payment_kind_enum" AS ENUM ('PRINCIPAL', 'CHARGE', 'REFUND');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "camporee_supply_payment_status_enum" AS ENUM ('ISSUED', 'PAID', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "local_camporees"
    ADD COLUMN IF NOT EXISTS "supply_edit_cutoff_local_time" VARCHAR(5) NOT NULL DEFAULT '21:00';

ALTER TABLE "union_camporees"
    ADD COLUMN IF NOT EXISTS "supply_edit_cutoff_local_time" VARCHAR(5) NOT NULL DEFAULT '21:00';

ALTER TABLE "local_camporees"
    DROP CONSTRAINT IF EXISTS "local_camporees_supply_cutoff_check";
ALTER TABLE "local_camporees"
    ADD CONSTRAINT "local_camporees_supply_cutoff_check"
    CHECK ("supply_edit_cutoff_local_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

ALTER TABLE "union_camporees"
    DROP CONSTRAINT IF EXISTS "union_camporees_supply_cutoff_check";
ALTER TABLE "union_camporees"
    ADD CONSTRAINT "union_camporees_supply_cutoff_check"
    CHECK ("supply_edit_cutoff_local_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

CREATE TABLE IF NOT EXISTS "camporee_supply_slots" (
    "camporee_supply_slot_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "local_camporee_id" INTEGER,
    "union_camporee_id" INTEGER,
    "label" VARCHAR(80) NOT NULL,
    "deliver_time" VARCHAR(5) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camporee_supply_slots_pkey" PRIMARY KEY ("camporee_supply_slot_id"),
    CONSTRAINT "camporee_supply_slots_local_camporee_id_fkey"
        FOREIGN KEY ("local_camporee_id") REFERENCES "local_camporees"("local_camporee_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_slots_union_camporee_id_fkey"
        FOREIGN KEY ("union_camporee_id") REFERENCES "union_camporees"("union_camporee_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_slots_label_check"
        CHECK (char_length(btrim("label")) > 0),
    CONSTRAINT "camporee_supply_slots_deliver_time_check"
        CHECK ("deliver_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    CONSTRAINT "camporee_supply_slots_camporee_xor_check"
        CHECK (
            ("local_camporee_id" IS NOT NULL AND "union_camporee_id" IS NULL)
            OR ("local_camporee_id" IS NULL AND "union_camporee_id" IS NOT NULL)
        )
);

CREATE INDEX IF NOT EXISTS "idx_camporee_supply_slots_local"
    ON "camporee_supply_slots"("local_camporee_id", "sort_order")
    WHERE "local_camporee_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_camporee_supply_slots_union"
    ON "camporee_supply_slots"("union_camporee_id", "sort_order")
    WHERE "union_camporee_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "camporee_supply_products" (
    "camporee_supply_product_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "local_camporee_id" INTEGER,
    "union_camporee_id" INTEGER,
    "name" VARCHAR(120) NOT NULL,
    "uom" "camporee_supply_uom_enum" NOT NULL,
    "unit_cost_centavos" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camporee_supply_products_pkey" PRIMARY KEY ("camporee_supply_product_id"),
    CONSTRAINT "camporee_supply_products_local_camporee_id_fkey"
        FOREIGN KEY ("local_camporee_id") REFERENCES "local_camporees"("local_camporee_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_products_union_camporee_id_fkey"
        FOREIGN KEY ("union_camporee_id") REFERENCES "union_camporees"("union_camporee_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_products_name_check"
        CHECK (char_length(btrim("name")) > 0),
    CONSTRAINT "camporee_supply_products_cost_check"
        CHECK ("unit_cost_centavos" >= 0),
    CONSTRAINT "camporee_supply_products_camporee_xor_check"
        CHECK (
            ("local_camporee_id" IS NOT NULL AND "union_camporee_id" IS NULL)
            OR ("local_camporee_id" IS NULL AND "union_camporee_id" IS NOT NULL)
        )
);

CREATE INDEX IF NOT EXISTS "idx_camporee_supply_products_local"
    ON "camporee_supply_products"("local_camporee_id", "active")
    WHERE "local_camporee_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_camporee_supply_products_union"
    ON "camporee_supply_products"("union_camporee_id", "active")
    WHERE "union_camporee_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "camporee_supply_plans" (
    "camporee_supply_plan_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "local_field_id" INTEGER NOT NULL,
    "club_id" INTEGER NOT NULL,
    "club_section_id" INTEGER NOT NULL,
    "local_camporee_id" INTEGER,
    "union_camporee_id" INTEGER,
    "status" "camporee_supply_plan_status_enum" NOT NULL DEFAULT 'DRAFT',
    "committed_total_centavos" INTEGER NOT NULL DEFAULT 0,
    "submitted_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camporee_supply_plans_pkey" PRIMARY KEY ("camporee_supply_plan_id"),
    CONSTRAINT "camporee_supply_plans_local_field_id_fkey"
        FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_plans_club_id_fkey"
        FOREIGN KEY ("club_id") REFERENCES "clubs"("club_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_plans_club_section_id_fkey"
        FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_plans_local_camporee_id_fkey"
        FOREIGN KEY ("local_camporee_id") REFERENCES "local_camporees"("local_camporee_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_plans_union_camporee_id_fkey"
        FOREIGN KEY ("union_camporee_id") REFERENCES "union_camporees"("union_camporee_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_plans_submitted_by_id_fkey"
        FOREIGN KEY ("submitted_by_id") REFERENCES "users"("user_id")
        ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_plans_committed_check"
        CHECK ("committed_total_centavos" >= 0),
    CONSTRAINT "camporee_supply_plans_camporee_xor_check"
        CHECK (
            ("local_camporee_id" IS NOT NULL AND "union_camporee_id" IS NULL)
            OR ("local_camporee_id" IS NULL AND "union_camporee_id" IS NOT NULL)
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_supply_plans_section_local"
    ON "camporee_supply_plans"("club_section_id", "local_camporee_id")
    WHERE "local_camporee_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_supply_plans_section_union"
    ON "camporee_supply_plans"("club_section_id", "union_camporee_id")
    WHERE "union_camporee_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_camporee_supply_plans_lf_status"
    ON "camporee_supply_plans"("local_field_id", "status");
CREATE INDEX IF NOT EXISTS "idx_camporee_supply_plans_local"
    ON "camporee_supply_plans"("local_camporee_id", "status");
CREATE INDEX IF NOT EXISTS "idx_camporee_supply_plans_union"
    ON "camporee_supply_plans"("union_camporee_id", "status");

CREATE TABLE IF NOT EXISTS "camporee_supply_lines" (
    "camporee_supply_line_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "supply_date" DATE NOT NULL,
    "slot_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" DECIMAL(12, 3) NOT NULL,
    "unit_cost_centavos" INTEGER NOT NULL,
    "line_total_centavos" INTEGER NOT NULL,

    CONSTRAINT "camporee_supply_lines_pkey" PRIMARY KEY ("camporee_supply_line_id"),
    CONSTRAINT "camporee_supply_lines_plan_id_fkey"
        FOREIGN KEY ("plan_id") REFERENCES "camporee_supply_plans"("camporee_supply_plan_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_lines_slot_id_fkey"
        FOREIGN KEY ("slot_id") REFERENCES "camporee_supply_slots"("camporee_supply_slot_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_lines_product_id_fkey"
        FOREIGN KEY ("product_id") REFERENCES "camporee_supply_products"("camporee_supply_product_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_lines_qty_check"
        CHECK ("qty" > 0),
    CONSTRAINT "camporee_supply_lines_cost_check"
        CHECK ("unit_cost_centavos" >= 0 AND "line_total_centavos" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_supply_lines_plan_date_slot_product"
    ON "camporee_supply_lines"("plan_id", "supply_date", "slot_id", "product_id");
CREATE INDEX IF NOT EXISTS "idx_camporee_supply_lines_slot"
    ON "camporee_supply_lines"("slot_id");
CREATE INDEX IF NOT EXISTS "idx_camporee_supply_lines_product"
    ON "camporee_supply_lines"("product_id");
CREATE INDEX IF NOT EXISTS "idx_camporee_supply_lines_date"
    ON "camporee_supply_lines"("supply_date");

CREATE TABLE IF NOT EXISTS "camporee_supply_payment_docs" (
    "camporee_supply_payment_doc_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "local_field_id" INTEGER NOT NULL,
    "club_section_id" INTEGER NOT NULL,
    "local_camporee_id" INTEGER,
    "union_camporee_id" INTEGER,
    "kind" "camporee_supply_payment_kind_enum" NOT NULL,
    "parent_id" UUID,
    "folio" INTEGER NOT NULL,
    "folio_reference" VARCHAR(16) NOT NULL,
    "total_centavos" INTEGER NOT NULL,
    "status" "camporee_supply_payment_status_enum" NOT NULL DEFAULT 'ISSUED',
    "note" TEXT,
    "created_by_id" UUID NOT NULL,
    "paid_by_id" UUID,
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camporee_supply_payment_docs_pkey" PRIMARY KEY ("camporee_supply_payment_doc_id"),
    CONSTRAINT "camporee_supply_payment_docs_plan_id_fkey"
        FOREIGN KEY ("plan_id") REFERENCES "camporee_supply_plans"("camporee_supply_plan_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_payment_docs_parent_id_fkey"
        FOREIGN KEY ("parent_id") REFERENCES "camporee_supply_payment_docs"("camporee_supply_payment_doc_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_payment_docs_local_field_id_fkey"
        FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_payment_docs_club_section_id_fkey"
        FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_payment_docs_local_camporee_id_fkey"
        FOREIGN KEY ("local_camporee_id") REFERENCES "local_camporees"("local_camporee_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_payment_docs_union_camporee_id_fkey"
        FOREIGN KEY ("union_camporee_id") REFERENCES "union_camporees"("union_camporee_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_payment_docs_created_by_id_fkey"
        FOREIGN KEY ("created_by_id") REFERENCES "users"("user_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_payment_docs_paid_by_id_fkey"
        FOREIGN KEY ("paid_by_id") REFERENCES "users"("user_id")
        ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_payment_docs_total_check"
        CHECK ("total_centavos" > 0),
    CONSTRAINT "camporee_supply_payment_docs_kind_parent_check"
        CHECK (
            ("kind" = 'PRINCIPAL' AND "parent_id" IS NULL)
            OR ("kind" IN ('CHARGE', 'REFUND') AND "parent_id" IS NOT NULL)
        ),
    CONSTRAINT "camporee_supply_payment_docs_camporee_xor_check"
        CHECK (
            ("local_camporee_id" IS NOT NULL AND "union_camporee_id" IS NULL)
            OR ("local_camporee_id" IS NULL AND "union_camporee_id" IS NOT NULL)
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_supply_payments_lf_folio"
    ON "camporee_supply_payment_docs"("local_field_id", "folio_reference");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_supply_payments_principal"
    ON "camporee_supply_payment_docs"("plan_id")
    WHERE "kind" = 'PRINCIPAL';
CREATE INDEX IF NOT EXISTS "idx_camporee_supply_payments_plan"
    ON "camporee_supply_payment_docs"("plan_id", "kind", "status");
CREATE INDEX IF NOT EXISTS "idx_camporee_supply_payments_lf_status"
    ON "camporee_supply_payment_docs"("local_field_id", "status");
CREATE INDEX IF NOT EXISTS "idx_camporee_supply_payments_section"
    ON "camporee_supply_payment_docs"("club_section_id", "status");

CREATE TABLE IF NOT EXISTS "camporee_supply_deliveries" (
    "camporee_supply_delivery_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "line_id" UUID NOT NULL,
    "qty" DECIMAL(12, 3) NOT NULL,
    "delivered_by_id" UUID NOT NULL,
    "note" TEXT,
    "delivered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camporee_supply_deliveries_pkey" PRIMARY KEY ("camporee_supply_delivery_id"),
    CONSTRAINT "camporee_supply_deliveries_line_id_fkey"
        FOREIGN KEY ("line_id") REFERENCES "camporee_supply_lines"("camporee_supply_line_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_deliveries_delivered_by_id_fkey"
        FOREIGN KEY ("delivered_by_id") REFERENCES "users"("user_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_deliveries_qty_check"
        CHECK ("qty" > 0)
);

CREATE INDEX IF NOT EXISTS "idx_camporee_supply_deliveries_line"
    ON "camporee_supply_deliveries"("line_id", "delivered_at");

CREATE TABLE IF NOT EXISTS "camporee_supply_plan_audits" (
    "camporee_supply_plan_audit_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "reason" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camporee_supply_plan_audits_pkey" PRIMARY KEY ("camporee_supply_plan_audit_id"),
    CONSTRAINT "camporee_supply_plan_audits_plan_id_fkey"
        FOREIGN KEY ("plan_id") REFERENCES "camporee_supply_plans"("camporee_supply_plan_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_plan_audits_actor_id_fkey"
        FOREIGN KEY ("actor_id") REFERENCES "users"("user_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_camporee_supply_plan_audits_plan"
    ON "camporee_supply_plan_audits"("plan_id", "created_at");

CREATE TABLE IF NOT EXISTS "camporee_supply_folio_counters" (
    "local_field_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "last_folio" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camporee_supply_folio_counters_pkey" PRIMARY KEY ("local_field_id", "year"),
    CONSTRAINT "camporee_supply_folio_counters_local_field_id_fkey"
        FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_supply_folio_counters_folio_check"
        CHECK ("last_folio" >= 0)
);
