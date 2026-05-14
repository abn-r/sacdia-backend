-- Migration: 20260513180000_materiales_init
-- Date: 2026-05-13
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Introduces the Materiales module schema:
--   5 enums, 9 tables for the complete order-management, inventory,
--   comprobantes, and configuration feature set.
--
-- Idempotent: uses IF NOT EXISTS for CREATE TYPE and CREATE TABLE.
-- Safe to re-run (will no-op if already applied).

-- ─── STEP 1: Enums ───────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "MaterialOrderEstado" AS ENUM ('en_revision', 'aprobada', 'pagada', 'entregada', 'cancelada');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MaterialDisponibilidad" AS ENUM ('pendiente', 'disponible', 'parcial', 'agotado');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MaterialComprobanteStatus" AS ENUM ('pendiente', 'aprobado', 'rechazado');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MaterialVariantType" AS ENUM ('talla', 'color');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "MaterialEntrega" AS ENUM ('recoger', 'envio');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── STEP 2: Tables in FK-safe order ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS material_categories (
  id         UUID        NOT NULL DEFAULT gen_random_uuid(),
  slug       VARCHAR(100) NOT NULL,
  label      VARCHAR(200) NOT NULL,
  icon       VARCHAR(100) NULL,
  sort_order INT         NOT NULL DEFAULT 0,
  active     BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT material_categories_pkey PRIMARY KEY (id),
  CONSTRAINT material_categories_slug_key UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS material_products (
  id                   UUID         NOT NULL DEFAULT gen_random_uuid(),
  sku                  VARCHAR(100) NOT NULL,
  title                VARCHAR(200) NOT NULL,
  description          TEXT         NULL,
  material_category_id UUID         NOT NULL,
  club_type_id         INT          NOT NULL,
  price_centavos       INT          NOT NULL,
  stock                INT          NOT NULL DEFAULT 0,
  active               BOOLEAN      NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT material_products_pkey PRIMARY KEY (id),
  CONSTRAINT material_products_sku_key UNIQUE (sku),
  CONSTRAINT material_products_category_fk FOREIGN KEY (material_category_id)
    REFERENCES material_categories(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT material_products_club_type_fk FOREIGN KEY (club_type_id)
    REFERENCES club_types(club_type_id) ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS idx_material_products_active_type_cat
  ON material_products (active, club_type_id, material_category_id);
CREATE INDEX IF NOT EXISTS idx_material_products_title
  ON material_products (title);

CREATE TABLE IF NOT EXISTS material_variants (
  id         UUID                 NOT NULL DEFAULT gen_random_uuid(),
  product_id UUID                 NOT NULL,
  type       "MaterialVariantType" NOT NULL,

  CONSTRAINT material_variants_pkey PRIMARY KEY (id),
  CONSTRAINT uq_material_variant_per_product UNIQUE (product_id),
  CONSTRAINT material_variants_product_fk FOREIGN KEY (product_id)
    REFERENCES material_products(id) ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS material_variant_options (
  id         UUID         NOT NULL DEFAULT gen_random_uuid(),
  variant_id UUID         NOT NULL,
  label      VARCHAR(100) NOT NULL,
  stock      INT          NOT NULL DEFAULT 0,

  CONSTRAINT material_variant_options_pkey PRIMARY KEY (id),
  CONSTRAINT uq_material_variant_option_label UNIQUE (variant_id, label),
  CONSTRAINT material_variant_options_variant_fk FOREIGN KEY (variant_id)
    REFERENCES material_variants(id) ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE IF NOT EXISTS material_orders (
  id                 UUID                   NOT NULL DEFAULT gen_random_uuid(),
  folio_referencia   VARCHAR(12)            NULL,
  estado             "MaterialOrderEstado"  NOT NULL DEFAULT 'en_revision',
  club_section_id    INT                    NOT NULL,
  created_by         UUID                   NOT NULL,
  approved_by        UUID                   NULL,
  validated_by       UUID                   NULL,
  delivered_by       UUID                   NULL,
  cancelled_by       UUID                   NULL,
  subtotal_centavos  INT                    NOT NULL DEFAULT 0,
  envio_centavos     INT                    NOT NULL DEFAULT 0,
  total_centavos     INT                    NOT NULL DEFAULT 0,
  entrega            "MaterialEntrega"      NOT NULL,
  notas              TEXT                   NULL,
  cancel_reason      TEXT                   NULL,
  refund_pending     BOOLEAN                NOT NULL DEFAULT false,
  bank_name          TEXT                   NULL,
  bank_account_clabe VARCHAR(18)            NULL,
  account_holder     TEXT                   NULL,
  pickup_address     TEXT                   NULL,
  created_at         TIMESTAMPTZ            NOT NULL DEFAULT now(),
  approved_at        TIMESTAMPTZ            NULL,
  paid_at            TIMESTAMPTZ            NULL,
  delivered_at       TIMESTAMPTZ            NULL,
  cancelled_at       TIMESTAMPTZ            NULL,
  updated_at         TIMESTAMPTZ            NOT NULL DEFAULT now(),

  CONSTRAINT material_orders_pkey PRIMARY KEY (id),
  CONSTRAINT material_orders_folio_key UNIQUE (folio_referencia),
  CONSTRAINT material_orders_section_fk FOREIGN KEY (club_section_id)
    REFERENCES club_sections(club_section_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT material_orders_created_by_fk FOREIGN KEY (created_by)
    REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT material_orders_approved_by_fk FOREIGN KEY (approved_by)
    REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT material_orders_validated_by_fk FOREIGN KEY (validated_by)
    REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT material_orders_delivered_by_fk FOREIGN KEY (delivered_by)
    REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT material_orders_cancelled_by_fk FOREIGN KEY (cancelled_by)
    REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS idx_material_orders_estado_created
  ON material_orders (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_orders_section_estado
  ON material_orders (club_section_id, estado);
CREATE INDEX IF NOT EXISTS idx_material_orders_created_by
  ON material_orders (created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS material_order_lines (
  id                  UUID                    NOT NULL DEFAULT gen_random_uuid(),
  order_id            UUID                    NOT NULL,
  product_id          UUID                    NOT NULL,
  variant_option_id   UUID                    NULL,
  qty                 INT                     NOT NULL,
  price_centavos      INT                     NOT NULL,
  disponibilidad      "MaterialDisponibilidad" NOT NULL DEFAULT 'pendiente',
  qty_disponible      INT                     NULL,
  line_total_centavos INT                     NOT NULL DEFAULT 0,

  CONSTRAINT material_order_lines_pkey PRIMARY KEY (id),
  CONSTRAINT uq_material_order_line UNIQUE (order_id, product_id, variant_option_id),
  CONSTRAINT material_order_lines_order_fk FOREIGN KEY (order_id)
    REFERENCES material_orders(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT material_order_lines_product_fk FOREIGN KEY (product_id)
    REFERENCES material_products(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT material_order_lines_variant_option_fk FOREIGN KEY (variant_option_id)
    REFERENCES material_variant_options(id) ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS idx_material_order_lines_order
  ON material_order_lines (order_id);

CREATE TABLE IF NOT EXISTS material_comprobantes (
  id                     UUID                       NOT NULL DEFAULT gen_random_uuid(),
  order_id               UUID                       NOT NULL,
  r2_key                 TEXT                       NOT NULL,
  file_name              TEXT                       NOT NULL,
  mime_type              VARCHAR(100)               NOT NULL,
  size_bytes             INT                        NOT NULL,
  monto_centavos         INT                        NOT NULL,
  ref_bancaria_declarada TEXT                       NULL,
  fecha_pago             DATE                       NULL,
  status                 "MaterialComprobanteStatus" NOT NULL DEFAULT 'pendiente',
  uploaded_by            UUID                       NOT NULL,
  validated_by           UUID                       NULL,
  reject_reason          TEXT                       NULL,
  created_at             TIMESTAMPTZ                NOT NULL DEFAULT now(),
  validated_at           TIMESTAMPTZ                NULL,

  CONSTRAINT material_comprobantes_pkey PRIMARY KEY (id),
  CONSTRAINT material_comprobantes_order_fk FOREIGN KEY (order_id)
    REFERENCES material_orders(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT material_comprobantes_uploaded_by_fk FOREIGN KEY (uploaded_by)
    REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT material_comprobantes_validated_by_fk FOREIGN KEY (validated_by)
    REFERENCES users(user_id) ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS idx_material_comprobantes_order_created
  ON material_comprobantes (order_id, created_at);

CREATE TABLE IF NOT EXISTS material_folio_counters (
  year       INT         NOT NULL,
  last_folio INT         NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT material_folio_counters_pkey PRIMARY KEY (year)
);

CREATE TABLE IF NOT EXISTS material_config (
  id                     INT         NOT NULL DEFAULT 1,
  bank_name              TEXT        NULL,
  bank_account_clabe     VARCHAR(18) NULL,
  account_holder         TEXT        NULL,
  envio_centavos_default INT         NOT NULL DEFAULT 0,
  pickup_address         TEXT        NULL,
  delivery_options       JSONB       NOT NULL DEFAULT '[]',
  updated_by             UUID        NULL,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT material_config_pkey PRIMARY KEY (id),
  CONSTRAINT material_config_updated_by_fk FOREIGN KEY (updated_by)
    REFERENCES users(user_id) ON DELETE SET NULL ON UPDATE NO ACTION
);

-- ─── STEP 3 (T1.4): Partial unique index (requires raw SQL) ──────────────────

CREATE UNIQUE INDEX IF NOT EXISTS uq_comprobante_aprobado_por_orden
  ON material_comprobantes (order_id)
  WHERE status = 'aprobado';

-- ─── STEP 4 (T1.5): Seed material_config singleton row ───────────────────────

INSERT INTO material_config (id, envio_centavos_default, delivery_options, updated_at)
VALUES (1, 0, '[]'::jsonb, NOW())
ON CONFLICT (id) DO NOTHING;
