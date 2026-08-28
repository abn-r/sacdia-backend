-- Pedidos de camporee: biblioteca territorial, oferta por evento, órdenes de sección.
-- Plan: docs/plans/2026-08-24-pedidos-camporees-consolidado-codex.md
-- No hay unique (club_section_id, camporee): se permiten pedidos suplementarios.

DO $$ BEGIN
    CREATE TYPE "camporee_order_owner_scope_enum" AS ENUM ('DIVISION', 'UNION', 'LOCAL_FIELD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "camporee_order_size_scheme_enum" AS ENUM ('LETTER', 'NUMERIC', 'NONE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "camporee_order_status_enum" AS ENUM
        ('ISSUED', 'PROOF_SUBMITTED', 'PROOF_REJECTED', 'PAID', 'DELIVERED', 'CANCELLED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "camporee_order_proof_status_enum" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "local_camporees"
    ADD COLUMN IF NOT EXISTS "orders_enabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "orders_opens_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "orders_deadline" TIMESTAMPTZ(6);

ALTER TABLE "union_camporees"
    ADD COLUMN IF NOT EXISTS "orders_enabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "orders_opens_at" TIMESTAMPTZ(6),
    ADD COLUMN IF NOT EXISTS "orders_deadline" TIMESTAMPTZ(6);

CREATE TABLE IF NOT EXISTS "camporee_order_products" (
    "camporee_order_product_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_scope" "camporee_order_owner_scope_enum" NOT NULL,
    "owner_division_id" INTEGER,
    "owner_union_id" INTEGER,
    "owner_local_field_id" INTEGER,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "size_scheme" "camporee_order_size_scheme_enum" NOT NULL,
    "club_type_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "modified_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camporee_order_products_pkey" PRIMARY KEY ("camporee_order_product_id"),
    CONSTRAINT "camporee_order_products_owner_division_id_fkey"
        FOREIGN KEY ("owner_division_id") REFERENCES "divisions"("division_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_products_owner_union_id_fkey"
        FOREIGN KEY ("owner_union_id") REFERENCES "unions"("union_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_products_owner_local_field_id_fkey"
        FOREIGN KEY ("owner_local_field_id") REFERENCES "local_fields"("local_field_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_products_club_type_id_fkey"
        FOREIGN KEY ("club_type_id") REFERENCES "club_types"("club_type_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_products_created_by_id_fkey"
        FOREIGN KEY ("created_by_id") REFERENCES "users"("user_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_products_modified_by_id_fkey"
        FOREIGN KEY ("modified_by_id") REFERENCES "users"("user_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_products_title_check"
        CHECK (char_length(btrim("title")) > 0),
    CONSTRAINT "camporee_order_products_owner_xor_check"
        CHECK (
            (
                "owner_scope" = 'DIVISION'
                AND "owner_division_id" IS NOT NULL
                AND "owner_union_id" IS NULL
                AND "owner_local_field_id" IS NULL
            )
            OR (
                "owner_scope" = 'UNION'
                AND "owner_division_id" IS NULL
                AND "owner_union_id" IS NOT NULL
                AND "owner_local_field_id" IS NULL
            )
            OR (
                "owner_scope" = 'LOCAL_FIELD'
                AND "owner_division_id" IS NULL
                AND "owner_union_id" IS NULL
                AND "owner_local_field_id" IS NOT NULL
            )
        )
);

CREATE INDEX IF NOT EXISTS "idx_camporee_order_products_division_active"
    ON "camporee_order_products"("owner_division_id", "active");
CREATE INDEX IF NOT EXISTS "idx_camporee_order_products_union_active"
    ON "camporee_order_products"("owner_union_id", "active");
CREATE INDEX IF NOT EXISTS "idx_camporee_order_products_lf_active"
    ON "camporee_order_products"("owner_local_field_id", "active");

CREATE TABLE IF NOT EXISTS "camporee_order_product_options" (
    "camporee_order_product_option_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "label" VARCHAR(40) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "camporee_order_product_options_pkey" PRIMARY KEY ("camporee_order_product_option_id"),
    CONSTRAINT "camporee_order_product_options_product_id_fkey"
        FOREIGN KEY ("product_id") REFERENCES "camporee_order_products"("camporee_order_product_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_product_options_label_check"
        CHECK (char_length(btrim("label")) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_order_product_options_product_label"
    ON "camporee_order_product_options"("product_id", "label");

CREATE TABLE IF NOT EXISTS "camporee_order_offerings" (
    "camporee_order_offering_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "local_camporee_id" INTEGER,
    "union_camporee_id" INTEGER,
    "product_id" UUID NOT NULL,
    "price_centavos" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID NOT NULL,
    "modified_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camporee_order_offerings_pkey" PRIMARY KEY ("camporee_order_offering_id"),
    CONSTRAINT "camporee_order_offerings_local_camporee_id_fkey"
        FOREIGN KEY ("local_camporee_id") REFERENCES "local_camporees"("local_camporee_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_offerings_union_camporee_id_fkey"
        FOREIGN KEY ("union_camporee_id") REFERENCES "union_camporees"("union_camporee_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_offerings_product_id_fkey"
        FOREIGN KEY ("product_id") REFERENCES "camporee_order_products"("camporee_order_product_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_offerings_created_by_id_fkey"
        FOREIGN KEY ("created_by_id") REFERENCES "users"("user_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_offerings_modified_by_id_fkey"
        FOREIGN KEY ("modified_by_id") REFERENCES "users"("user_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_offerings_price_check"
        CHECK ("price_centavos" > 0),
    CONSTRAINT "camporee_order_offerings_camporee_xor_check"
        CHECK (
            ("local_camporee_id" IS NOT NULL AND "union_camporee_id" IS NULL)
            OR ("local_camporee_id" IS NULL AND "union_camporee_id" IS NOT NULL)
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_order_offerings_local_product"
    ON "camporee_order_offerings"("local_camporee_id", "product_id")
    WHERE "local_camporee_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_order_offerings_union_product"
    ON "camporee_order_offerings"("union_camporee_id", "product_id")
    WHERE "union_camporee_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "camporee_orders" (
    "camporee_order_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "local_field_id" INTEGER NOT NULL,
    "club_id" INTEGER NOT NULL,
    "club_section_id" INTEGER NOT NULL,
    "local_camporee_id" INTEGER,
    "union_camporee_id" INTEGER,
    "folio" INTEGER NOT NULL,
    "folio_reference" VARCHAR(16) NOT NULL,
    "status" "camporee_order_status_enum" NOT NULL DEFAULT 'ISSUED',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
    "total_centavos" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "issued_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "authorized_without_proof" BOOLEAN NOT NULL DEFAULT false,
    "authorized_by_id" UUID,
    "authorized_at" TIMESTAMPTZ(6),
    "authorization_reason" TEXT,
    "delivered_to_section_by_id" UUID,
    "delivered_to_section_at" TIMESTAMPTZ(6),
    "cancelled_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "expired_at" TIMESTAMPTZ(6),
    "idempotency_key" UUID,
    "bank_name" VARCHAR(255),
    "bank_account" VARCHAR(64),
    "bank_clabe" VARCHAR(32),
    "bank_holder" VARCHAR(255),
    "cash_instructions" TEXT,
    "extra_notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camporee_orders_pkey" PRIMARY KEY ("camporee_order_id"),
    CONSTRAINT "camporee_orders_local_field_id_fkey"
        FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_orders_club_id_fkey"
        FOREIGN KEY ("club_id") REFERENCES "clubs"("club_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_orders_club_section_id_fkey"
        FOREIGN KEY ("club_section_id") REFERENCES "club_sections"("club_section_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_orders_local_camporee_id_fkey"
        FOREIGN KEY ("local_camporee_id") REFERENCES "local_camporees"("local_camporee_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_orders_union_camporee_id_fkey"
        FOREIGN KEY ("union_camporee_id") REFERENCES "union_camporees"("union_camporee_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_orders_issued_by_id_fkey"
        FOREIGN KEY ("issued_by_id") REFERENCES "users"("user_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_orders_approved_by_id_fkey"
        FOREIGN KEY ("approved_by_id") REFERENCES "users"("user_id")
        ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "camporee_orders_authorized_by_id_fkey"
        FOREIGN KEY ("authorized_by_id") REFERENCES "users"("user_id")
        ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "camporee_orders_delivered_to_section_by_id_fkey"
        FOREIGN KEY ("delivered_to_section_by_id") REFERENCES "users"("user_id")
        ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "camporee_orders_cancelled_by_id_fkey"
        FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("user_id")
        ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "camporee_orders_total_check"
        CHECK ("total_centavos" > 0),
    CONSTRAINT "camporee_orders_folio_check"
        CHECK ("folio" > 0),
    CONSTRAINT "camporee_orders_camporee_xor_check"
        CHECK (
            ("local_camporee_id" IS NOT NULL AND "union_camporee_id" IS NULL)
            OR ("local_camporee_id" IS NULL AND "union_camporee_id" IS NOT NULL)
        )
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_orders_lf_folio"
    ON "camporee_orders"("local_field_id", "folio_reference");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_orders_idempotency"
    ON "camporee_orders"("issued_by_id", "idempotency_key");
CREATE INDEX IF NOT EXISTS "idx_camporee_orders_lf_status"
    ON "camporee_orders"("local_field_id", "status");
CREATE INDEX IF NOT EXISTS "idx_camporee_orders_section_local_created"
    ON "camporee_orders"("club_section_id", "local_camporee_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_camporee_orders_section_union_created"
    ON "camporee_orders"("club_section_id", "union_camporee_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_camporee_orders_local_status"
    ON "camporee_orders"("local_camporee_id", "status");
CREATE INDEX IF NOT EXISTS "idx_camporee_orders_union_status"
    ON "camporee_orders"("union_camporee_id", "status");

CREATE TABLE IF NOT EXISTS "camporee_order_lines" (
    "camporee_order_line_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "camporee_member_id" INTEGER NOT NULL,
    "beneficiary_user_id" UUID NOT NULL,
    "beneficiary_name_snapshot" VARCHAR(255) NOT NULL,
    "offering_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "option_id" UUID,
    "product_title_snapshot" VARCHAR(200) NOT NULL,
    "option_label_snapshot" VARCHAR(40),
    "qty" INTEGER NOT NULL,
    "unit_price_centavos" INTEGER NOT NULL,
    "line_total_centavos" INTEGER NOT NULL,
    "delivered_to_member_by_id" UUID,
    "delivered_to_member_at" TIMESTAMPTZ(6),

    CONSTRAINT "camporee_order_lines_pkey" PRIMARY KEY ("camporee_order_line_id"),
    CONSTRAINT "camporee_order_lines_order_id_fkey"
        FOREIGN KEY ("order_id") REFERENCES "camporee_orders"("camporee_order_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_lines_camporee_member_id_fkey"
        FOREIGN KEY ("camporee_member_id") REFERENCES "camporee_members"("camporee_member_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_lines_beneficiary_user_id_fkey"
        FOREIGN KEY ("beneficiary_user_id") REFERENCES "users"("user_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_lines_offering_id_fkey"
        FOREIGN KEY ("offering_id") REFERENCES "camporee_order_offerings"("camporee_order_offering_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_lines_product_id_fkey"
        FOREIGN KEY ("product_id") REFERENCES "camporee_order_products"("camporee_order_product_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_lines_option_id_fkey"
        FOREIGN KEY ("option_id") REFERENCES "camporee_order_product_options"("camporee_order_product_option_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_lines_delivered_to_member_by_id_fkey"
        FOREIGN KEY ("delivered_to_member_by_id") REFERENCES "users"("user_id")
        ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_lines_qty_check"
        CHECK ("qty" >= 1 AND "qty" <= 99),
    CONSTRAINT "camporee_order_lines_unit_price_check"
        CHECK ("unit_price_centavos" > 0),
    CONSTRAINT "camporee_order_lines_line_total_check"
        CHECK ("line_total_centavos" = "qty" * "unit_price_centavos")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_order_lines_sequence"
    ON "camporee_order_lines"("order_id", "sequence");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_order_lines_member_offering_option"
    ON "camporee_order_lines"("order_id", "camporee_member_id", "offering_id", "option_id");
-- Postgres trata NULL != NULL en índices únicos; este parcial cubre option_id IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_camporee_order_lines_member_offering_null_option"
    ON "camporee_order_lines"("order_id", "camporee_member_id", "offering_id")
    WHERE "option_id" IS NULL;

CREATE TABLE IF NOT EXISTS "camporee_order_proofs" (
    "camporee_order_proof_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "r2_key" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "camporee_order_proof_status_enum" NOT NULL DEFAULT 'SUBMITTED',
    "reject_reason" TEXT,
    "uploaded_by_id" UUID NOT NULL,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camporee_order_proofs_pkey" PRIMARY KEY ("camporee_order_proof_id"),
    CONSTRAINT "camporee_order_proofs_order_id_fkey"
        FOREIGN KEY ("order_id") REFERENCES "camporee_orders"("camporee_order_id")
        ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_proofs_uploaded_by_id_fkey"
        FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("user_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "camporee_order_proofs_reviewed_by_id_fkey"
        FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("user_id")
        ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "idx_camporee_order_proofs_order_status"
    ON "camporee_order_proofs"("order_id", "status");

CREATE TABLE IF NOT EXISTS "camporee_order_folio_counters" (
    "local_field_id" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "last_folio" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "camporee_order_folio_counters_pkey" PRIMARY KEY ("local_field_id", "year"),
    CONSTRAINT "camporee_order_folio_counters_local_field_id_fkey"
        FOREIGN KEY ("local_field_id") REFERENCES "local_fields"("local_field_id")
        ON DELETE NO ACTION ON UPDATE NO ACTION
);
